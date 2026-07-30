# frozen_string_literal: true

# 配置管理模块 - 被 VoiceInputExt include 后提供实例方法。
# 负责：默认配置、加载/保存 YAML 配置、API Key 脱敏、深度复制、配置校验。
# 默认配置源：config.default.yml（唯一源），前后端统一从此文件读取默认值。
require "yaml"
require "fileutils"

module VoiceInputConfigManager
  EXT_DIR = File.expand_path("..", __dir__ || File.dirname(__FILE__))
  DEFAULT_CONFIG_PATH = File.join(EXT_DIR, "config.default.yml")
  FALLBACK_CONFIG_PATH = File.expand_path("~/.clacky/voice-config.yml")

  # ── 硬编码兜底（仅在 config.default.yml 不可读时使用）──
  # 正常情况下 config.default.yml 是唯一默认配置源，此处仅为安全网。
  HARDCODED_DEFAULTS = {
    "asr" => {
      "provider" => "google",
      "model" => "paraformer-realtime-v1",
      "api_key" => ""
    },
    "language" => "zh-CN",
    "shortcuts" => {
      "toggle"     => { "modifiers" => %w[Control Shift], "key" => "z" },
      "stop"       => { "modifiers" => %w[Control Shift], "key" => "s" },
      "start"      => { "modifiers" => %w[Control Shift], "key" => "r" },
      "voice_mode" => { "modifiers" => %w[Control Shift], "key" => "m" }
    },
    "exit_words" => ["拜拜", "结束语音交互", "退出语音交互", "关闭语音", "再见", "byebye"],
    "silence_timeout_ms" => 1500,
    "voice_mode_restart_delay_ms" => 300,
    "default_mode" => "push-to-talk",
    "sound" => {
      "start"  => "default",
      "stop"   => "default",
      "volume" => 0.4
    }
  }.freeze

  # ── 唯一默认配置源：从 config.default.yml 读取 ──
  # 修改默认值时只需改 config.default.yml，无需改代码。
  DEFAULT_CONFIG = begin
    if File.exist?(DEFAULT_CONFIG_PATH)
      YAML.safe_load_file(DEFAULT_CONFIG_PATH, permitted_classes: []) || HARDCODED_DEFAULTS
    else
      HARDCODED_DEFAULTS
    end
  rescue => e
    $stderr.puts "[VoiceInputConfigManager] Failed to load config.default.yml: #{e.message}"
    HARDCODED_DEFAULTS
  end.freeze

  # ── 模块级方法：读取配置文件 ──
  # 供 ws_server.rb 等非 include 调用方使用。
  # config_path: 主配置文件路径（扩展 config.yml）
  # fallback_path: API Key 备用配置路径（~/.clacky/voice-config.yml）
  # 返回合并后的配置 Hash，始终非 nil。
  def self.load_config_file(config_path = File.join(EXT_DIR, "config.yml"),
                            fallback_path = FALLBACK_CONFIG_PATH)
    cfg = if File.exist?(config_path)
            YAML.safe_load_file(config_path, permitted_classes: []) || {}
          elsif File.exist?(DEFAULT_CONFIG_PATH)
            YAML.safe_load_file(DEFAULT_CONFIG_PATH, permitted_classes: []) || DEFAULT_CONFIG.dup
          else
            DEFAULT_CONFIG.dup
          end

    # 备用配置回退：主配置无 API Key 时，从 ~/.clacky/voice-config.yml 读取
    api_key = cfg.dig("asr", "api_key")
    if (api_key.nil? || api_key.to_s.strip.empty?) && File.exist?(fallback_path)
      begin
        fallback_cfg = YAML.safe_load_file(fallback_path, permitted_classes: []) || {}
        fallback_key = fallback_cfg.dig("asr", "api_key")
        if fallback_key && !fallback_key.to_s.strip.empty?
          cfg["asr"] ||= {}
          cfg["asr"]["api_key"] = fallback_key
          cfg["asr"]["provider"] = fallback_cfg.dig("asr", "provider") || cfg["asr"]["provider"] || "dashscope"
        end
      rescue => e
        $stderr.puts "[VoiceInputConfigManager] Fallback config load failed: #{e.message}"
      end
    end

    cfg
  rescue => e
    $stderr.puts "[VoiceInputConfigManager] load_config_file failed: #{e.class}: #{e.message}"
    $stderr.puts "[VoiceInputConfigManager] config_path=#{config_path}, exist=#{File.exist?(config_path)}"
    if File.exist?(config_path)
      $stderr.puts "[VoiceInputConfigManager] config.yml exists but parsing failed, file may be corrupted."
    end
    DEFAULT_CONFIG.dup
  end

  def config_path
    @config_path ||= File.join(ext_dir, "config.yml")
  end

  def load_config
    cfg = VoiceInputConfigManager.load_config_file(config_path, FALLBACK_CONFIG_PATH)

    # 首次启动时，如果 config.yml 不存在，自动从默认配置创建
    unless File.exist?(config_path)
      save_config(cfg)
    end

    cfg
  rescue => e
    logger.error("[voice-input] load_config failed: #{e.class}: #{e.message}")
    DEFAULT_CONFIG.dup
  end

  def save_config(hash)
    # ── 保护 API Key：如果传入的 key 为空/脱敏值，保留已有文件中的真实 key ──
    incoming_key = hash.dig("asr", "api_key")
    if incoming_key.nil? || incoming_key.to_s.strip.empty? || incoming_key.to_s.include?("****")
      if File.exist?(config_path)
        begin
          existing = YAML.safe_load_file(config_path, permitted_classes: [])
          existing_key = existing&.dig("asr", "api_key")
          if existing_key && !existing_key.to_s.strip.empty? && !existing_key.to_s.include?("****")
            hash["asr"] ||= {}
            hash["asr"]["api_key"] = existing_key
            logger.info("[voice-input] save_config: 保留已有 API Key（传入的 key 为空/脱敏）")
          end
        rescue => e
          logger.warn("[voice-input] save_config: 读取已有配置失败，无法保留 API Key: #{e.message}")
        end
      end
    end

    FileUtils.mkdir_p(File.dirname(config_path))
    File.write(config_path, hash.to_yaml)
  end

  def mask_api_key(key)
    return "" if key.nil? || key.empty?
    key.length < 8 ? "****" : key[0..3] + "****" + key[-4..]
  end

  # 校验 PUT /config 提交的配置，不合法时返回 error! 并中断。
  def validate_patch_config!(cfg)
    unless %w[push-to-talk hands-free].include?(cfg["default_mode"].to_s)
      return error!("default_mode must be 'push-to-talk' or 'hands-free'")
    end

    if cfg.key?("silence_timeout_ms") && cfg["silence_timeout_ms"].to_i < 0
      return error!("silence_timeout_ms must be >= 0")
    end

    if cfg.dig("sound", "volume")
      vol = cfg["sound"]["volume"].to_f
      if vol < 0.0 || vol > 1.0
        return error!("sound.volume must be between 0.0 and 1.0")
      end
    end
  end

  private

  def deep_dup(obj)
    case obj
    when Hash  then obj.each_with_object({}) { |(k, v), h| h[k] = deep_dup(v) }
    when Array then obj.map { |v| deep_dup(v) }
    else obj
    end
  end
end
