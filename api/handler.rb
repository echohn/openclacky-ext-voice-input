# frozen_string_literal: true

# API backend for "voice-input" extension. Mounted at /api/ext/voice-input/.
#
# Endpoints:
#   GET  /              — 扩展信息
#   GET  /config        — 读取语音配置
#   PUT  /config        — 保存语音配置
#   GET  /ws-port       — 获取独立 WebSocket 服务端口
#   GET  /sounds/:filename — 提供自定义音效文件
#
# 配置存储在扩展根目录的 config.yml 中，与原有 ~/.clacky/voice-config.yml 互不影响。
# 配置逻辑 → config_manager.rb | WebSocket 服务 → ws_server.rb
require_relative "config_manager"
require_relative "ws_server"

# 扩展加载时启动独立 WebSocket 服务
VoiceInputWsServer.start

class VoiceInputExt < Clacky::ApiExtension
  include VoiceInputConfigManager

  # ── routes ───────────────────────────────────────────────────────────

  # Serve custom sound files from extension's sounds/ directory.
  # Accessed as: /api/ext/voice-input/sounds/voice-start.mp3
  get "/sounds/:filename" do
    sounds_dir = File.expand_path("~/.clacky/sounds")
    FileUtils.mkdir_p(sounds_dir) unless Dir.exist?(sounds_dir)
    filepath = File.expand_path(File.join(sounds_dir, params[:filename]))
    # Prevent directory traversal
    unless filepath.start_with?(File.expand_path(sounds_dir))
      error!("Forbidden", status: 403)
    end
    unless File.file?(filepath) && File.readable?(filepath)
      error!("Not Found", status: 404)
    end
    ct = case File.extname(filepath).downcase
         when ".mp3"  then "audio/mpeg"
         when ".wav"  then "audio/wav"
         when ".ogg"  then "audio/ogg"
         when ".aac"  then "audio/aac"
         when ".m4a"  then "audio/mp4"
         when ".flac" then "audio/flac"
         when ".webm" then "audio/webm"
         else "application/octet-stream"
         end
    body = File.binread(filepath)
    raise Clacky::ApiExtension::Halt.new(200, body, ct,
      extra_headers: { "Content-Length" => body.bytesize.to_s })
  end

  get "/ws-port" do
    port = VoiceInputWsServer.port
    unless port
      # 延迟启动（防御性）
      port = VoiceInputWsServer.start
    end
    json(host: "127.0.0.1", port: port, running: VoiceInputWsServer.running?)
  end

  get "/" do

    json(
      extension: "voice-input",
      version: "0.1.0",
      message: "语音输入扩展运行中"
    )
  end

  get "/config" do
    cfg = load_config
    # mask API key before sending to frontend
    if cfg["asr"] && cfg["asr"]["api_key"]
      cfg = deep_dup(cfg)
      cfg["asr"]["api_key_masked"] = mask_api_key(cfg["asr"]["api_key"])
      cfg["asr"].delete("api_key")
    end
    json(ok: true, config: cfg)
  end

  put "/config" do
    # Use ApiExtension#json_body — reads req.body (not Sinatra's request.body)
    body = json_body
    incoming = body["config"] || body

    cfg = load_config

    # Merge top-level scalar keys
    %w[language default_mode silence_timeout_ms voice_mode_restart_delay_ms].each do |key|
      cfg[key] = incoming[key] if incoming.key?(key)
    end

    if incoming["asr"]
      cfg["asr"] ||= {}
      cfg["asr"]["provider"] = incoming["asr"]["provider"] if incoming["asr"].key?("provider")
      cfg["asr"]["model"] = incoming["asr"]["model"] if incoming["asr"].key?("model")
      if incoming["asr"].key?("api_key") && !incoming["asr"]["api_key"].to_s.include?("****") && !incoming["asr"]["api_key"].to_s.strip.empty?
        cfg["asr"]["api_key"] = incoming["asr"]["api_key"]
      end
    end

    if incoming["sound"]
      cfg["sound"] ||= {}
      cfg["sound"]["start"]  = incoming["sound"]["start"]  if incoming["sound"].key?("start")
      cfg["sound"]["stop"]   = incoming["sound"]["stop"]   if incoming["sound"].key?("stop")
      cfg["sound"]["volume"] = incoming["sound"]["volume"].to_f if incoming["sound"].key?("volume")
    end

    cfg["shortcuts"] = incoming["shortcuts"] if incoming.key?("shortcuts")
    cfg["exit_words"] = incoming["exit_words"] if incoming.key?("exit_words")

    # Validate (delegated to VoiceInputConfigManager)
    validate_patch_config!(cfg)

    save_config(cfg)

    # ── non-blocking warnings ──────────────────────────────────────────
    warnings = []

    # 1. Sound file existence check
    sounds_dir = File.expand_path("~/.clacky/sounds")
    %w[start stop].each do |key|
      val = cfg.dig("sound", key)
      next if val.nil? || val == "none" || val == "default"
      filepath = File.join(sounds_dir, val)
      unless File.file?(filepath)
        warnings << {
          "field" => "sound.#{key}",
          "message" => "音效文件 #{val} 不存在，请放入 #{sounds_dir}/ 目录"
        }
      end
    end

    # 2. DashScope API Key validity check
    if cfg.dig("asr", "provider") == "dashscope" &&
       cfg.dig("asr", "api_key").to_s.length > 0
      begin
        require "net/http" unless defined?(Net::HTTP)
        uri = URI("https://dashscope.aliyuncs.com/compatible-mode/v1/models")
        http = Net::HTTP.new(uri.host, uri.port)
        http.use_ssl = true
        http.open_timeout = 5
        http.read_timeout = 5
        req = Net::HTTP::Get.new(uri)
        req["Authorization"] = "Bearer #{cfg["asr"]["api_key"]}"
        res = http.request(req)
        if res.code == "401" || res.code == "403"
          warnings << {
            "field" => "api_key",
            "message" => "API Key 无效或被禁用"
          }
        end
      rescue Net::TimeoutError, Net::OpenTimeout, Errno::ECONNREFUSED, SocketError => e
        logger.warn("DashScope API key validation skipped (network): #{e.message}")
      rescue StandardError => e
        logger.warn("DashScope API key validation error: #{e.message}")
      end
    end

    # Return masked config
    resp = deep_dup(cfg)
    if resp["asr"] && resp["asr"]["api_key"]
      resp["asr"]["api_key_masked"] = mask_api_key(resp["asr"]["api_key"])
      resp["asr"].delete("api_key")
    end

    result = { success: true, config: resp }
    result[:warnings] = warnings unless warnings.empty?
    json(result)
  end
end
