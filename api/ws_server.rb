# frozen_string_literal: true

# ws_server.rb - 独立 WebSocket 服务（方案 B）
#
# 不依赖 openclacky 内部路由，在独立 TCP 端口上提供 DashScope ASR relay。
# 前端先调 REST API 获取端口号，再直连本服务。
#
# 使用 Ruby stdlib（TCPServer / OpenSSL / Socket），零额外 gem 依赖。
# 复用 websocket gem 做握手解析和帧编解码（ext.yml 的 api handler 已依赖它）。
# 配置读取统一走 config_manager.rb 的 load_config_file 方法。

require "socket"
require "openssl"
require "json"
require "websocket"
require "uri"
require_relative "config_manager"

module VoiceInputWsServer
  # 默认端点（可通过 config.yml 的 asr.ws_url 覆盖）
  DEFAULT_DASHSCOPE_WS_URL = "wss://dashscope.aliyuncs.com/api-ws/v1/inference/".freeze
  EXT_DIR = File.expand_path("..", __dir__ || File.dirname(__FILE__))

  HANDSHAKE_READ_TIMEOUT = 5  # 等待客户端发送完整 HTTP upgrade 请求的超时（秒）
  UPSTREAM_CONNECT_TIMEOUT = 10 # 上游 DashScope / iFlytek 连接超时（秒）

  # ── 日志分级 ──────────────────────────────────────────────────────
  LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }.freeze
  @log_level = LOG_LEVELS[:info]  # 生产默认 info；调试时可设 :debug

  class << self
    attr_reader :port

    # 设置日志级别（:debug / :info / :warn / :error）
    def log_level=(level)
      @log_level = LOG_LEVELS[level] || LOG_LEVELS[:info]
    end

    # ── 分级日志（写 stderr，openclacky 进程会捕获） ────────────────
    # msg:    日志内容
    # level:  :debug | :info | :warn | :error（默认 :info）
    def log(msg, level = :info)
      return if LOG_LEVELS[level] < @log_level
      $stderr.puts "[VoiceInputWsServer] [#{level.to_s.upcase}] #{msg}"
    end

    # ── 启动服务 ──────────────────────────────────────────────────────
    # host:  bind 地址（默认 127.0.0.1）
    # port:  0 = 让 OS 分配随机端口
    # 返回实际监听的端口号
    def start(host: "127.0.0.1", port: 0)
      return @port if @running

      @server = TCPServer.new(host, port)
      @port   = @server.addr[1]
      @running = true

      @thread = Thread.new do
        log("WS 服务启动在 #{host}:#{@port}")
        loop do
          begin
            client = @server.accept
            Thread.new(client) { |socket| handle_client(socket) }
          rescue IOError, Errno::EBADF
            break unless @running
          rescue => e
            log("Accept 错误: #{e.class}: #{e.message}", :error)
          end
        end
        log("WS 服务主循环退出")
      end
      @thread.abort_on_exception = false

      at_exit { stop }
      @port
    end

    def stop
      @running = false
      @server&.close rescue nil
      @thread&.kill rescue nil
    end

    def running?
      @running && @thread&.alive?
    end

    private

    # ── 处理单个客户端连接 ─────────────────────────────────────────────
    def handle_client(socket)
      peer = socket.peeraddr[2] rescue "unknown"
      log("[#{peer}] 新连接", :debug)

      # 1. 读取 HTTP upgrade 请求（非阻塞 + 超时）
      request = read_http_request(socket, HANDSHAKE_READ_TIMEOUT)
      unless request
        log("[#{peer}] 读取握手请求超时或失败", :error)
        socket.close rescue nil
        return
      end
      log("[#{peer}] 收到握手请求 (#{request.bytesize} bytes)", :debug)

      # 2. 解析 WebSocket 握手
      handshake = ::WebSocket::Handshake::Server.new
      handshake << request

      unless handshake.finished? && handshake.valid?
        log("[#{peer}] 无效的 WebSocket 握手: finished=#{handshake.finished?} valid=#{handshake.valid?}", :error)
        http_400(socket, "Bad Request: not a valid WebSocket upgrade request")
        return
      end

      ws_version = handshake.version
      log("[#{peer}] 握手有效, version=#{ws_version}", :debug)

      # 3. 读取 ASR 配置（统一走 config_manager.load_config_file，含备用配置回退）
      cfg = VoiceInputConfigManager.load_config_file(
        File.join(EXT_DIR, "config.yml"),
        VoiceInputConfigManager::FALLBACK_CONFIG_PATH
      )

      provider = cfg.dig("asr", "provider") || "dashscope"
      api_key  = cfg.dig("asr", "api_key")

      if api_key.nil? || api_key.to_s.strip.empty?
        masked = "(empty)"
        log("[#{peer}] 未配置 API Key - provider=#{provider}", :error)
        fail_handshake(socket, handshake, ws_version, "未配置 API Key，请在设置中填写")
        return
      end

      # 脱敏日志：只打前4后4位
      masked = api_key.length > 8 ? "#{api_key[0..3]}****#{api_key[-4..]}" : "****"
      log("[#{peer}] API Key 已加载 (脱敏: #{masked}, provider=#{provider})", :debug)

      # 4. 先完成浏览器 WebSocket 握手（101 Switching Protocols），避免客户端超时
      socket.write(handshake.to_s)
      log("[#{peer}] 已发送 101 Switching Protocols", :debug)

      # 5. 连接上游 DashScope（异步进行，客户端已经拿到 101）
      upstream_url = upstream_url_for(provider, cfg)
      upstream_headers = {
        "Authorization"            => "bearer #{api_key}",
        "X-DashScope-DataInspection" => "enable"
      }

      log("[#{peer}] 连接上游: #{provider} -> #{upstream_url}", :debug)

      uri = URI.parse(upstream_url)
      result = open_upstream(uri, upstream_headers)
      unless result
        log("[#{peer}] 上游连接失败，关闭浏览器 WS", :error)
        close_with_error(socket, ws_version, "API Key 无效或 ASR 服务不可用")
        return
      end

      upstream_socket, upstream_ver = result
      log("[#{peer}] 上游连接成功, upstream_ver=#{upstream_ver}", :debug)

      # 6. 双向中继
      relay(socket, upstream_socket, ws_version, upstream_ver)
    rescue => e
      log("[#{peer}] 客户端处理错误: #{e.class}: #{e.message}\n#{e.backtrace.first(3).join("\n")}", :error)
    ensure
      close_socket(socket)
      log("[#{peer}] 连接关闭", :debug)
    end

    # ── 非阻塞读取 HTTP 请求头（直到 \r\n\r\n 或超时）────────────────
    def read_http_request(socket, timeout)
      request = String.new(encoding: "BINARY")
      deadline = Time.now + timeout

      loop do
        remaining = deadline - Time.now
        break if remaining <= 0

        readable, _, _ = IO.select([socket], nil, nil, remaining)
        unless readable
          log("read_http_request: select 超时（已读取 #{request.bytesize} bytes）", :warn)
          break
        end

        begin
          chunk = socket.read_nonblock(4096)
          request << chunk
          break if request.include?("\r\n\r\n")
        rescue IO::WaitReadable
          # select 说可读但 read_nonblock 又说不可读，极少见，继续循环
          next
        rescue EOFError, Errno::ECONNRESET, Errno::EPIPE => e
          log("read_http_request: #{e.class}: #{e.message}", :warn)
          break
        end
      end

      request.include?("\r\n\r\n") ? request : nil
    end

    # ── 返回 HTTP 400（当客户端发来的不是 WebSocket upgrade）───────────
    def http_400(socket, message)
      body = "#{message}\n"
      response = "HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain\r\nContent-Length: #{body.bytesize}\r\nConnection: close\r\n\r\n#{body}"
      socket.write(response) rescue nil
      socket.close rescue nil
    end

    # ── 101 握手成功后上游连接失败时，优雅关闭浏览器 WS ────────────────
    def close_with_error(socket, ws_version, reason)
      frame = ::WebSocket::Frame::Outgoing::Server.new(
        version: ws_version,
        data: JSON.generate({ error: reason }),
        type: :close,
        code: 1011
      )
      socket.write(frame.to_s) rescue nil
      socket.close rescue nil
    end

    # ── 上游 URL（优先从配置读取，降级使用默认端点）──────────────────
    def upstream_url_for(provider, cfg = {})
      case provider
      when "dashscope"
        cfg.dig("asr", "ws_url") || DEFAULT_DASHSCOPE_WS_URL
      when "iflytek"
        cfg.dig("asr", "ws_url") || "wss://iat-api.xfyun.cn/v2/iat"
      else
        DEFAULT_DASHSCOPE_WS_URL
      end
    end

    # ── 连接上游 WebSocket ─────────────────────────────────────────────
    def open_upstream(uri, extra_headers)
      tcp = TCPSocket.new(uri.host, uri.port || (uri.scheme == "wss" ? 443 : 80))

      if uri.scheme == "wss"
        ctx = OpenSSL::SSL::SSLContext.new
        ctx.verify_mode = OpenSSL::SSL::VERIFY_PEER
        ctx.ca_file = OpenSSL::X509::DEFAULT_CERT_FILE
        tcp = OpenSSL::SSL::SSLSocket.new(tcp, ctx)
        tcp.hostname = uri.host
        tcp.connect
      end

      hs = ::WebSocket::Handshake::Client.new(url: uri.to_s)
      extra_headers.each { |k, v| hs.headers[k] = v }
      tcp.write(hs.to_s)

      # 读取上游响应 - 也用非阻塞方式避免死等
      response = String.new(encoding: "BINARY")
      deadline = Time.now + UPSTREAM_CONNECT_TIMEOUT
      loop do
        remaining = deadline - Time.now
        break if remaining <= 0

        readable, _, _ = IO.select([tcp], nil, nil, remaining)
        unless readable
          log("open_upstream: 等待上游响应超时", :error)
          tcp.close rescue nil
          return nil
        end

        begin
          chunk = tcp.read_nonblock(4096)
          response << chunk
          hs << chunk
          break if hs.finished?
        rescue IO::WaitReadable
          next
        rescue EOFError, Errno::ECONNRESET, Errno::EPIPE => e
          log("open_upstream: #{e.class}: #{e.message}", :warn)
          break
        end
      end

      unless hs.valid?
        log("上游握手无效: #{hs.error}", :error)
        log("上游响应: #{response[0..500]}", :warn)
        tcp.close rescue nil
        return nil
      end

      [tcp, hs.version]
    rescue => e
      log("上游连接失败: #{e.message}", :error)
      nil
    end

    # ── 双向数据中继 ───────────────────────────────────────────────────
    # 预分配 BINARY buffer 避免 websocket gem 编码冲突（Encoding::CompatibilityError）
    def relay(browser_socket, upstream, ws_version, upstream_ver)
      incoming = ::WebSocket::Frame::Incoming::Server.new(version: ws_version)
      upstream_incoming = ::WebSocket::Frame::Incoming::Client.new(version: upstream_ver)
      upstream_buf = String.new("", encoding: "BINARY")
      browser_buf   = String.new("", encoding: "BINARY")
      out_client = ::WebSocket::Frame::Outgoing::Client
      out_server = ::WebSocket::Frame::Outgoing::Server

      loop do
        readable, _, _ = IO.select([browser_socket, upstream], nil, nil, 30)
        break unless readable

        # ── 浏览器 -> 上游 ──
        if readable.include?(browser_socket)
          begin
            chunk = browser_socket.read_nonblock(65536, browser_buf, exception: false)
            case chunk
            when :wait_readable
            when nil
              break
            else
              incoming << chunk
              while (frame = incoming.next)
                case frame.type
                when :text, :binary
                  begin
                    upstream.write(out_client.new(version: upstream_ver, data: frame.data, type: frame.type).to_s)
                  rescue => e
                    log("中继 浏览器->上游 写入错误: #{e.class}: #{e.message}", :error)
                    return
                  end
                when :ping
                  begin
                    browser_socket.write(out_server.new(version: ws_version, type: :pong, data: frame.data).to_s)
                  rescue => e
                    return
                  end
                when :close
                  browser_socket.write(out_server.new(version: ws_version, type: :close, data: "").to_s) rescue nil
                  upstream.close rescue nil
                  return
                end
              end
            end
          rescue IOError, Errno::ECONNRESET, Errno::EPIPE => e
            log("中继 浏览器读取错误: #{e.class}: #{e.message}", :warn)
            break
          end
        end

        # ── 上游 -> 浏览器 ──
        if readable.include?(upstream)
          begin
            chunk = upstream.read_nonblock(65536, upstream_buf, exception: false)
            case chunk
            when :wait_readable
            when nil
              break
            else
              upstream_incoming << chunk.dup
              while (frame = upstream_incoming.next)
                case frame.type
                when :text, :binary
                  begin
                    browser_socket.write(out_server.new(version: ws_version, data: frame.data, type: frame.type).to_s)
                  rescue => e
                    log("中继 上游->浏览器 写入错误: #{e.class}: #{e.message}", :error)
                    return
                  end
                when :ping
                  upstream.write(out_client.new(version: upstream_ver, data: frame.data, type: :pong).to_s) rescue nil
                when :pong
                when :close
                  browser_socket.write(out_server.new(version: ws_version, type: :close, data: "").to_s) rescue nil
                  return
                end
              end
            end
          rescue IOError, Errno::ECONNRESET, Errno::EPIPE => e
            log("中继 上游读取错误: #{e.class}: #{e.message}", :warn)
            break
          end
        end
      end
    rescue => e
      log("中继错误: #{e.class}: #{e.message}", :error)
    ensure
      close_socket(upstream)
    end

    # ── 握手阶段失败：先完成握手，再发 close frame ─────────────────────
    def fail_handshake(socket, handshake, ws_version, reason)
      socket.write(handshake.to_s)
      frame = ::WebSocket::Frame::Outgoing::Server.new(
        version: ws_version,
        data: JSON.generate({ error: reason }),
        type: :close,
        code: 1011
      )
      socket.write(frame.to_s)
      socket.close
    rescue => e
      log("fail_handshake 错误: #{e.message}", :error)
      close_socket(socket)
    end

    def close_socket(socket)
      socket.close rescue nil
    end
  end
end
