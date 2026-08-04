# OpenClacky 语音输入扩展 — 技术方案

> 语言：中文 | 英文版本：[voice-input-proposal.md](voice-input-proposal.md)

## 1. 目标

以 **OpenClacky 独立扩展** 的形式提供开箱即用的语音输入能力：

- 默认使用 Google Web Speech API（浏览器原生，零配置）
- 高级用户可切换 DashScope（阿里云 Paraformer 实时 ASR），需配置 API Key
- 快捷键、退出词、提示音等全部可自定义
- 自带可视化设置面板，修改后即时生效并持久化
- 中英双语界面，跟随 OpenClacky 语言设置自动切换

> **与原始提案的关键区别**：原始提案描述的是集成到 OpenClacky 核心的方案（修改 `index.html`、`app.css`、`http_server.rb`）。实际实现是一个完全独立的扩展，通过 `ext.yml` 注册，不修改核心代码，可独立安装/卸载。

---

## 2. 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│              前端 (panels/voice-btn/ 多模块)                  │
│                                                               │
│  view.js (入口)                                               │
│  ├─ i18n 词典 (DICT zh/en) + t() 函数                         │
│  ├─ 配置加载/持久化 (GET/PUT /api/ext/voice-input/config)     │
│  └─ 动态链式加载子模块 + 并行加载 settings-panel.js            │
│                                                               │
│  voice-core.js (命名空间 + 录音控制 + 公共API)                 │
│  ├─ VoiceCore._s  共享状态 (设备级 + 会话级)                   │
│  ├─ VoiceCore._f  函数注册表                                   │
│  ├─ startRecording / stopRecording / toggleRecording          │
│  ├─ setVoiceMode / checkExit / buildExitPhrases               │
│  └─ updateAllBtnUI / createComposerUI / init                  │
│                                                               │
│  voice-state.js  ASR文本管理 + 会话隔离 + 编辑检测             │
│  voice-audio.js  录音开始/停止音效 (Web Audio API)             │
│  voice-engines.js  ASR引擎工厂 (浏览器原生 / DashScope)        │
│  voice-ui.js     CSS注入 + Composer按钮 + 计时器 + 快捷键      │
│  settings-panel.js  设置面板 UI + 配置变更 + 警告横幅           │
│                                                               │
│  引擎工厂 (voice-engines.js)                                  │
│  ├─ createBrowserEngine  纯浏览器 SpeechRecognition           │
│  └─ createDashScopeEngine  getUserMedia → PCM → WS → 后端中继   │
│                                                               │
├─────────────────────────────────────────────────────────────┤
│              后端 (api/ Ruby 模块)                             │
│                                                               │
│  handler.rb (REST API, 挂载于 /api/ext/voice-input/)          │
│  ├─ GET  /            扩展信息                                 │
│  ├─ GET  /config      读取配置 (API Key 脱敏)                 │
│  ├─ PUT  /config      保存配置 (含校验 + API Key 有效性验证)    │
│  ├─ GET  /ws-port     获取独立 WebSocket 服务端口               │
│  └─ GET  /sounds/:f   提供自定义音效文件 (路径遍历防护)         │
│                                                               │
│  config_manager.rb (配置管理)                                 │
│  ├─ load_config_file   读取配置 + 备用回退 (~/.clacky/...)      │
│  ├─ save_config        保存配置 (API Key 保护)                  │
│  ├─ mask_api_key       脱敏 (sk-a****b7e2)                     │
│  └─ validate_patch_config!  配置校验                           │
│                                                               │
│  ws_server.rb (独立 WebSocket TCP 服务)                       │
│  ├─ TCPServer + OpenSSL (零额外 gem 依赖)                      │
│  ├─ 浏览器 WS 握手 → 101 Switching Protocols                   │
│  ├─ 连接上游 DashScope wss://dashscope.aliyuncs.com/...        │
│  └─ 双向透明中继 (无协议转换)                                  │
└─────────────────────────────────────────────────────────────┘
```

**核心设计原则**：

- **扩展隔离**：通过 `ext.yml` 注册，不修改 OpenClacky 核心代码，可独立安装/卸载
- **模块化前端**：IIFE 模式，6 个 JS 子模块职责分离，`view.js` 动态链式加载
- **引擎工厂模式**：Google/DashScope 差异在各自闭包内消解，通过 `emitResult()` 统一汇入输入框
- **独立 WebSocket 服务**：不依赖 OpenClacky 内部路由，在独立 TCP 端口提供 DashScope ASR 中继
- **配置安全**：API Key 仅存储在服务端，前端始终脱敏显示，保存时空值/脱敏值不会覆盖已有 Key
- **会话隔离**：每个对话会话维护独立的 ASR 文本缓冲区，切换不丢失

---

## 3. ASR 引擎对比

| | 浏览器原生（默认） | DashScope |
|---|---|---|
| 实现位置 | 纯浏览器 `SpeechRecognition` | `getUserMedia` → PCM → WS → 后端中继 → DashScope |
| 需要后端？ | 否 | 是（独立 WS 服务 + REST API） |
| 需要 API Key？ | 否 | 是（阿里云 DashScope） |
| 浏览器要求 | Chrome / Edge（需支持 Web Speech API） | 任意现代浏览器（需支持 `getUserMedia`） |
| 中文识别质量 | 中等 | 优秀 |
| 中英混合 | 中等 | 优秀 |
| 自动标点 | 无 | 有 |
| 流式结果 | ✅（`interimResults: true`） | ✅（`streaming: "duplex"`） |
| 用户配置 | 零配置直接用 | 配 API Key + 选 DashScope |

> 两种引擎的流式中间结果行为一致——都是累积型逐字更新。`voice-engines.js` 的 `emitResult()` 统一处理，`voice-state.js` 的状态机无需感知引擎差异。

**引擎选择逻辑**（`createEngine()`）：

```js
var isDs = cfg.asr && cfg.asr.provider === "dashscope";
return isDs ? f.createDashScopeEngine() : f.createBrowserEngine();
```

---

## 4. 前端设计

### 4.1 设计原则

- **自包含 IIFE 模块**：每个 JS 文件使用 IIFE 封装，不污染全局；通过 `window.VoiceCore._s`（状态）和 `window.VoiceCore._f`（函数）共享内部接口
- **三个全局命名空间**：
  - `window.VoiceInput` — 共享依赖（cfg / defs / t / ext / formatShortcut / saveConfig）
  - `window.VoiceCore` — 语音核心公共 API（录音控制、模式切换、UI 创建）
  - `window.VoiceSettings` — 设置面板 API
- **CSS 隔离**：样式通过 `voice-ui.js` 动态注入 `<style id="voice-core-style">` 标签，不修改 OpenClacky 的 `app.css`；使用 CSS 变量与平台保持一致
- **i18n 自包含**：双语词典内嵌于 `view.js` 的 `DICT` 对象，自有 `t()` 函数，不依赖 OpenClacky 的 `I18n.t()`

### 4.2 模块架构与加载链

`view.js` 作为入口，负责动态加载子模块。加载策略：

```
view.js
  │
  ├── 并行加载 settings-panel.js → window.VoiceSettings
  │
  └── 链式加载 voice 模块（严格顺序）：
      voice-core.js   → 创建 VoiceCore 命名空间 (_s 状态 + _f 函数注册表)
      voice-state.js   → 向 _f 注册：文本处理、会话隔离、编辑检测
      voice-audio.js   → 向 _f 注册：音效播放
      voice-engines.js  → 向 _f 注册：引擎工厂、结果分发、静音检测、自动发送
      voice-ui.js      → 向 _f 注册：CSS注入、按钮UI、计时器、快捷键匹配
      → VoiceCore._ready = true → 触发 initApp()
```

**加载保护机制**：
- 每个子模块 10 秒超时保护，超时后跳过继续加载，不阻塞整个扩展
- `onerror` 回调同样跳过，确保单个模块加载失败不影响其他模块
- 版本戳 `?v=Date.now()` 防止浏览器缓存旧版子模块

### 4.3 VoiceCore 公开 API

`window.VoiceCore` 是前端核心入口。以下方法可在控制台、外部脚本中直接调用：

| API | 类型 | 说明 |
|-----|------|------|
| `VoiceCore.init()` | method | 初始化：构建退出词、挂载 Composer UI、注册全局快捷键监听、更新浏览器支持检测 |
| `VoiceCore.startRecording()` | async method | 开始录音：检查浏览器支持 → `gen++` → 创建引擎 → 播放开始音效 → 启动计时器 |
| `VoiceCore.stopRecording()` | method | 停止录音：停止引擎 → 播放停止音效 → 清理计时器 → 更新 UI |
| `VoiceCore.toggleRecording()` | method | 切换录音状态（开始 ↔ 停止） |
| `VoiceCore.setVoiceMode(on)` | method | 开启/关闭连续对话模式；开启时若未录音则自动开始，关闭时若在录音则停止 |
| `VoiceCore.createComposerUI()` | method | 创建输入框上方的 Composer UI（麦克风按钮 + 状态文本 + 浏览器警告） |
| `VoiceCore.updateAllBtnUI()` | method | 更新所有按钮的状态、样式、title 属性 |
| `VoiceCore.checkExit(text)` | method | 退出词检测：匹配则返回 `true` 并触发 `stopRecording()` |
| `VoiceCore.buildExitPhrases()` | method | 从配置构建退出词数组 |
| `VoiceCore.updateBrowserWarning()` | method | 检测浏览器 Web Speech API 支持情况，显示/隐藏警告横幅 |

**共享状态对象** `VoiceCore._s`（设备级 + 会话级）：

```
设备级（跨会话）: listening, voiceMode, engine, gen, retryCount, silenceTimer, exitPhrases
会话级:           sessionBuffers, activeSessionId, asrState, lastDisplay, editState
UI 引用:          composerBtn, composerStatus, errorToast, browserWarningBtn
计时器:           recordingStartTime, recordingTimerId
```

**`gen` 代际机制**：每次开始录音 `gen++`，引擎内部闭包保存 `myGen`，回调中检查 `s.gen === myGen` 确保只有当前录音轮次的结果被处理，防止旧引擎的异步回调干扰。

### 4.4 两种语音模式

通过 `VoiceCore.setVoiceMode(on)` 切换，状态存储在 `s.voiceMode`：

| 模式 | 激活方式 | 按钮外观 | 行为 |
|------|---------|---------|------|
| **点击发送** (Push-to-Talk) | 默认；快捷键 `Ctrl+Shift+Z` 或点击麦克风 | 录音时红色渐变 + `viMicPulse` 脉冲动画 (1.5s) | 点击开始录音，再点击停止；文字保留在输入框，手动发送 |
| **连续对话** (Hands-Free) | 快捷键 `Ctrl+Shift+M` 或 `setVoiceMode(true)` | 录音时紫色渐变 + `viBreath` 呼吸动画 (2s) | 持续监听，静默超过 `silence_timeout_ms` 自动发送当前句子，然后自动重启监听 |

**模式切换逻辑**：
- Push-to-Talk → Hands-Free：若当前未录音则自动开始录音
- Hands-Free → Push-to-Talk：若当前正在录音则停止

**自动重连与重试机制**（Hands-Free 模式下）：

| 引擎 | 触发条件 | 重试策略 |
|------|---------|---------|
| 浏览器原生 | `onend` 被浏览器静音自动触发 | 延迟 `voice_mode_restart_delay_ms` 后重建引擎；重建失败指数退避重试，最多 3 次 |
| DashScope | WS `onclose`（非正常关闭码） | `retryCount++`，延迟 `baseDelay × 1.5^(retryCount-1)` 后重连；最多 3 次 |

> `retryCount` 仅在用户手动操作（`toggleRecording` / 快捷键）时重置为 0。

### 4.5 DashScope 引擎实现细节

```
getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 } })
    ↓
AudioContext({ sampleRate: 16000 })
    ↓
createMediaStreamSource(stream) → createScriptProcessor(4096, 1, 1)
    ↓
onaudioprocess: Float32 → Int16 PCM 转换 → ws.send(pcm.buffer)
    ↓
独立 WebSocket 服务 → wss://dashscope.aliyuncs.com/api-ws/v1/inference/
```

**初始化握手**（WS `onopen`）：

```json
{
  "header": { "action": "run-task", "task_id": "voice-<timestamp>", "streaming": "duplex" },
  "payload": {
    "model": "paraformer-realtime-v1",
    "task_group": "audio",
    "task": "asr",
    "function": "recognition",
    "parameters": { "format": "pcm", "sample_rate": 16000, "language_hints": ["zh-CN"] }
  }
}
```

**结束握手**（`stop()` 时发送 `finish-task`）：

```json
{
  "header": { "task_id": "voice-<timestamp>", "action": "finish-task", "streaming": "duplex" },
  "payload": { "input": {} }
}
```

**端口获取**：前端先调 `GET /api/ext/voice-input/ws-port` 获取独立 WS 服务地址（`ws://127.0.0.1:<port>`），再直连。

### 4.6 配置项 (config.default.yml)

默认配置的唯一源是 `config.default.yml`，前后端统一从此文件读取。前端 `view.js` 中有一份硬编码兜底（仅在 API 不可达时使用）。

```yaml
asr:
  provider: google              # google | dashscope
  model: paraformer-realtime-v1 # DashScope 模型
language: zh-CN                 # BCP-47 语言标签 (zh-CN | en-US)
shortcuts:
  toggle:     { modifiers: [Control, Shift], key: z }   # 开始/停止
  stop:       { modifiers: [Control, Shift], key: s }   # 停止
  start:      { modifiers: [Control, Shift], key: r }   # 开始
  voice_mode: { modifiers: [Control, Shift], key: m }   # 切换模式
exit_words: [拜拜, 结束语音交互, 退出语音交互, 关闭语音, 再见, byebye]
silence_timeout_ms: 1500              # 连续对话模式静音超时 (ms)
voice_mode_restart_delay_ms: 300      # 语音模式自动重启延迟 (ms)
default_mode: push-to-talk            # 初始模式：push-to-talk | hands-free
sound:
  start: default                      # 开始音效 (default | none | 文件名)
  stop: default                        # 停止音效
  volume: 0.4                          # 音量 0.0 ~ 1.0
```

**配置加载与持久化流程**：

```
前端 view.js loadConfig()
  → GET /api/ext/voice-input/config (返回脱敏配置)
  → deepMerge(defs, serverConfig) → window.VoiceInput.cfg

前端 view.js saveConfig(partial)
  → PUT /api/ext/voice-input/config { config: partial }
  → 后端校验 + 保存 + API Key 有效性验证
  → 返回 { success: true, config: <脱敏>, warnings?: [...] }
  → 前端 deepMerge 更新 cfg
```

### 4.7 UI 设计

Composer UI 挂载在输入框上方（通过 `Clacky.ext.ui.mount("session.composer", ...)`）：

```
┌──────────────────────────────────────────────────────────────┐
│ [🎤 语音输入] [状态文本]                          [计时器]    │
│                                                              │
│ 未激活: 灰色边框                                              │
│ Push-to-Talk 录音中: 红色渐变 + viMicPulse 脉冲 (1.5s)        │
│ Hands-free 录音中:   紫色渐变 + viBreath 呼吸灯 (2s)          │
│ 浏览器不支持: 虚线边框 (.voice-disabled) + 警告横幅           │
│ hover: 品牌主色                                               │
└──────────────────────────────────────────────────────────────┘
```

**按钮状态类名切换**：

| 类名 | 条件 | 视觉效果 |
|------|------|---------|
| `.voice-mic-btn.recording` | Push-to-Talk 录音中 | 红色渐变 + `viMicPulse` 动画 |
| `.voice-mic-btn.voice-mode` | Hands-free 录音中 | 紫色渐变 + `viBreath` 动画 |
| `.voice-mic-btn.voice-disabled` | 浏览器不支持 | 虚线边框 + 降透明度 |

**录音计时器**：录音开始时记录 `recordingStartTime`，每秒更新显示 `mm:ss` 格式。

### 4.8 CSS 样式

样式通过 `voice-ui.js` 动态注入 `<style id="voice-core-style">` 标签，不在 OpenClacky 的 `app.css` 中。

**设计要点**：
- 使用 CSS 变量与 OpenClacky 平台保持一致（`--color-accent-primary`、`--color-border-primary`、`--color-bg-primary` 等）
- 不引入新的颜色常量，全部引用平台变量
- 动画定义：

```css
@keyframes viMicPulse {
  0%, 100% { box-shadow: 0 0 0 3px rgba(231,76,60,.25), 0 2px 6px rgba(0,0,0,.15); }
  50%      { box-shadow: 0 0 0 6px rgba(231,76,60,.15), 0 2px 8px rgba(0,0,0,.2); }
}

@keyframes viBreath {
  0%, 100% { box-shadow: 0 0 0 3px rgba(124,58,237,.2); }
  50%      { box-shadow: 0 0 0 8px rgba(124,58,237,.1); }
}
```

### 4.9 i18n 国际化

自包含双语词典，内嵌于 `view.js` 的 `DICT` 对象：

- **语言检测**：通过 `window.Clacky.I18n.lang()` 获取当前语言，默认 `zh`
- **翻译函数**：`t(key, params)` — 先查当前语言词典，回退 `en`，再回退原始 key
- **参数替换**：支持 `{param}` 模板替换（如 `{sounds_dir}`、`{engine}`、`{file}`）
- **动态切换**：监听 `langchange` 事件，语言变更时刷新 UI
- **不依赖** OpenClacky 的 `I18n.t()` / `data-i18n` 机制

### 4.10 音效系统

音效播放由 `voice-audio.js` 负责，两种模式：

| 音效值 | 播放方式 |
|--------|---------|
| `default` | Web Audio API 振荡器：开始 880Hz/150ms，停止 440Hz/250ms |
| `none` | 静音 |
| 文件名 | `new Audio("/api/ext/voice-input/sounds/<filename>")` 从 `~/.clacky/sounds/` 加载 |

音量通过 `sound.volume`（0.0 ~ 1.0）控制，默认 0.4。

### 4.11 文本状态管理与会话隔离

`voice-state.js` 负责 ASR 文本的生命周期管理：

**状态机**（`editState` 字段）：

| 状态 | 含义 | 触发条件 |
|------|------|---------|
| `clean` | 输入框内容与 ASR 输出一致 | 正常识别流程 |
| `editing` | 用户手动修改了输入框 | `oninput` 事件检测到 `val !== lastDisplay` |
| `cleared` | 用户清空了输入框 | `oninput` 检测到空值 |

**编辑吸收机制**：识别到 `isFinal` 结果时，若 `editState === "editing"`，调用 `absorbEditsForFinal()` 将用户手动修改的内容合并到 ASR 队列中，新结果在其后追加，不会覆盖用户编辑。

**会话隔离**：`sessionBuffers[sessionId]` 为每个对话会话维护独立的 ASR 状态。切换会话时保存当前会话上下文，切回时恢复。

---

## 5. 后端设计

### 5.1 REST API 路由

所有路由挂载于 `/api/ext/voice-input/`，由 `handler.rb` 提供：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 返回扩展信息（名称、版本、状态消息） |
| GET | `/config` | 读取配置；API Key 脱敏后返回（`sk-a****b7e2` 格式） |
| PUT | `/config` | 保存配置；含校验、API Key 有效性验证、音效文件存在性检查；返回脱敏配置 + 警告列表 |
| GET | `/ws-port` | 获取独立 WebSocket 服务地址（`{ host: "127.0.0.1", port: <N>, running: true }`） |
| GET | `/sounds/:filename` | 提供自定义音效文件（从 `~/.clacky/sounds/` 读取，含路径遍历防护） |

**PUT /config 保存逻辑**：

```
1. 读取现有配置
2. 合并传入字段（标量键 + asr + sound + shortcuts + exit_words）
3. API Key 保护：空值/脱敏值(含****)不覆盖已有 Key
4. 校验：default_mode 枚举、silence_timeout_ms >= 0、volume ∈ [0,1]
5. 保存到 config.yml
6. 非阻塞检查：
   a. 音效文件存在性（~/.clacky/sounds/）
   b. DashScope API Key 有效性（GET dashscope.aliyuncs.com/compatible-mode/v1/models）
7. 返回脱敏配置 + warnings[]
```

### 5.2 独立 WebSocket 服务 (ws_server.rb)

不依赖 OpenClacky 内部路由，在独立 TCP 端口上提供 DashScope ASR 中继。

**启动流程**：

```
handler.rb 加载时 → VoiceInputWsServer.start(host: "127.0.0.1", port: 0)
  → TCPServer.new → OS 分配随机端口 → @port = server.addr[1]
  → Thread.new { loop { accept → Thread.new { handle_client } } }
```

**单连接处理流程**：

```
1. read_http_request(socket, 5s超时)
   → 读取 HTTP upgrade 请求（非阻塞 + IO.select 超时）

2. WebSocket::Handshake::Server 解析握手
   → 验证有效性

3. 加载配置（config_manager.load_config_file）
   → 读取 API Key（含 ~/.clacky/voice-config.yml 备用回退）
   → 若无 API Key → fail_handshake(先完成101再发close frame)

4. 发送 101 Switching Protocols（先完成握手，避免客户端超时）

5. open_upstream(uri, headers)
   → TCPSocket → OpenSSL::SSL::SSLSocket → WebSocket::Handshake::Client
   → 连接 wss://dashscope.aliyuncs.com/api-ws/v1/inference/
   → 附带 Authorization: bearer <api_key>

6. relay(browser_socket, upstream_socket)
   → IO.select([browser, upstream], nil, nil, 30)
   → 浏览器→上游：解码 WS 帧 → 转发 text/binary
   → 上游→浏览器：解码 WS 帧 → 转发 text/binary
   → 处理 ping/pong/close 帧类型
```

**技术选型**：

| 组件 | 选择 | 理由 |
|------|------|------|
| TCP 服务 | `TCPServer` (Ruby stdlib) | 零额外依赖 |
| TLS | `OpenSSL::SSL::SSLContext` (Ruby stdlib) | 支持 wss:// |
| WS 握手/帧编解码 | `websocket` gem | 已被 ext.yml api handler 依赖 |
| 并发模型 | Thread-per-connection | 简单可靠，连接数低 |

**安全考虑**：
- 绑定 `127.0.0.1`，不暴露到外网
- API Key 日志脱敏（只打前4后4位）
- 非阻塞 IO + 超时保护（握手 5s，上游连接 10s，中继 30s select 超时）
- 预分配 BINARY buffer 避免 `websocket` gem 的 `Encoding::CompatibilityError`

### 5.3 配置管理 (config_manager.rb)

**配置层级**：

```
config.default.yml    ← 唯一默认配置源（前后端统一读取）
       ↓
config.yml           ← 用户配置（扩展目录，首次启动时从默认配置创建）
       ↓ (API Key 为空时回退)
~/.clacky/voice-config.yml  ← 备用配置（兼容旧版 OpenClacky 核心集成）
```

**API Key 保护机制**：

- `GET /config`：返回前调用 `mask_api_key()` 脱敏，原始 Key 从不返回前端
- `PUT /config`：传入的 Key 若为空或包含 `****`，保留 config.yml 中已有的真实 Key
- `mask_api_key(key)`：长度 < 8 返回 `"****"`，否则 `key[0..3] + "****" + key[-4..]`

**配置校验**（`validate_patch_config!`）：

- `default_mode` 必须为 `push-to-talk` 或 `hands-free`
- `silence_timeout_ms` 必须 ≥ 0
- `sound.volume` 必须 ∈ [0.0, 1.0]

**硬编码兜底**：`HARDCODED_DEFAULTS` 常量，仅在 `config.default.yml` 不可读时作为安全网使用。

### 5.4 安全考虑

- **API Key 不暴露**：仅存储在服务端 `config.yml` 中，前端始终通过 `mask_api_key()` 脱敏显示
- **API Key 有效性验证**：保存时异步请求 DashScope API 验证（5s 超时），无效则返回警告但不阻止保存
- **路径遍历防护**：`/sounds/:filename` 端点检查 `filepath.start_with?(sounds_dir)`，阻止 `../` 攻击
- **本地绑定**：WebSocket 服务绑定 `127.0.0.1`，不接受外部连接
- **日志脱敏**：API Key 在日志中只显示前4后4位

---

## 6. 文件结构

```
voice-input/
├── ext.yml                        # 扩展清单（id, version, contributes: api + panels）
├── config.yml                     # 用户配置（运行时生成/修改）
├── config.default.yml             # 默认配置（唯一默认源，前后端统一读取）
├── README.md                      # 用户文档
├── docs/
│   ├── voice-input-proposal.md       # 技术方案（英文版）
│   └── voice-input-proposal-zh.md    # 技术方案（中文版，本文档）
├── api/
│   ├── handler.rb                 # REST API 路由（~172行）
│   ├── config_manager.rb          # 配置管理模块（~167行）
│   └── ws_server.rb               # 独立 WebSocket ASR 中继服务（~402行）
└── panels/voice-btn/
    ├── view.js                    # 入口：i18n 词典、配置加载、子模块加载链、挂载（~427行）
    ├── voice-core.js              # 核心：命名空间、共享状态、录音控制、公共API（~219行）
    ├── voice-state.js             # 状态：ASR 文本管理、会话隔离、编辑检测（~173行）
    ├── voice-audio.js             # 音效：录音开始/停止音效播放（~71行）
    ├── voice-engines.js           # 引擎：浏览器原生 + DashScope 双引擎工厂（~409行）
    ├── voice-ui.js                # UI：CSS 注入、Composer 按钮、状态更新、计时器（~229行）
    └── settings-panel.js          # 设置面板：UI 构建、配置变更、警告横幅（~620行）
```

