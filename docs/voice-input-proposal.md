# OpenClacky Voice Input Extension - Technical Proposal

> Language: EN | 中文版本：[voice-input-proposal-zh.md](voice-input-proposal-zh.md)

## 1. Goals

Provide **out-of-the-box voice input** as a standalone OpenClacky extension:

- Default: Google Web Speech API (browser-native, zero configuration)
- Advanced: switch to DashScope (Alibaba Cloud Paraformer real-time ASR), requires API Key
- Fully customizable: shortcuts, exit words, sound effects
- Built-in visual settings panel with instant persistence
- Bilingual UI (Chinese/English), auto-switching with OpenClacky language setting

> **Key difference from the original proposal**: The original proposal described integration into the OpenClacky core (modifying `index.html`, `app.css`, `http_server.rb`). The actual implementation is a fully standalone extension registered via `ext.yml`, with no core modifications required. It can be independently installed/uninstalled.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│          Frontend (panels/voice-btn/ multi-module)           │
│                                                               │
│  view.js (entry point)                                        │
│  ├─ i18n dictionary (DICT zh/en) + t() function               │
│  ├─ Config load/persist (GET/PUT /api/ext/voice-input/config) │
│  └─ Dynamic chained sub-module loading + parallel settings-panel.js  │
│                                                               │
│  voice-core.js (namespace + recording control + public API)  │
│  ├─ VoiceCore._s  shared state (device-level + session-level) │
│  ├─ VoiceCore._f  function registry                           │
│  ├─ startRecording / stopRecording / toggleRecording          │
│  ├─ setVoiceMode / checkExit / buildExitPhrases               │
│  └─ updateAllBtnUI / createComposerUI / init                 │
│                                                               │
│  voice-state.js  ASR text management + session isolation + edit detection  │
│  voice-audio.js  Recording start/stop sound effects (Web Audio API)       │
│  voice-engines.js  ASR engine factory (Browser native / DashScope)         │
│  voice-ui.js     CSS injection + Composer button + timer + shortcuts       │
│  settings-panel.js  Settings panel UI + config changes + warning banners   │
│                                                               │
│  Engine factory (voice-engines.js)                            │
│  ├─ createBrowserEngine  Pure browser SpeechRecognition       │
│  └─ createDashScopeEngine  getUserMedia -> PCM -> WS -> backend relay      │
│                                                               │
├─────────────────────────────────────────────────────────────┤
│          Backend (api/ Ruby modules)                          │
│                                                               │
│  handler.rb (REST API, mounted at /api/ext/voice-input/)     │
│  ├─ GET  /            Extension info                          │
│  ├─ GET  /config      Read config (API Key masked)            │
│  ├─ PUT  /config      Save config (validation + API Key check)│
│  ├─ GET  /ws-port     Get standalone WebSocket service port   │
│  └─ GET  /sounds/:f   Serve custom sound files (path traversal protection)│
│                                                               │
│  config_manager.rb (Config management)                        │
│  ├─ load_config_file   Read config + fallback (~/.clacky/...) │
│  ├─ save_config        Save config (API Key protection)        │
│  ├─ mask_api_key       Masking (sk-a****b7e2)                 │
│  └─ validate_patch_config!  Config validation                  │
│                                                               │
│  ws_server.rb (Standalone WebSocket TCP service)             │
│  ├─ TCPServer + OpenSSL (zero extra gem dependencies)         │
│  ├─ Browser WS handshake -> 101 Switching Protocols           │
│  ├─ Connect upstream DashScope wss://dashscope.aliyuncs.com/... │
│  └─ Bidirectional transparent relay (no protocol conversion)  │
└─────────────────────────────────────────────────────────────┘
```

**Core design principles**:

- **Extension isolation**: Registered via `ext.yml`, no OpenClacky core modifications; independently installable/removable
- **Modular frontend**: IIFE pattern, 6 JS sub-modules with separated responsibilities, dynamically chain-loaded by `view.js`
- **Engine factory pattern**: Google/DashScope differences absorbed inside their respective closures, unified through `emitResult()` into the input box
- **Standalone WebSocket service**: Does not depend on OpenClacky internal routing; provides DashScope ASR relay on an independent TCP port
- **Config security**: API Key stored server-side only; frontend always receives masked values; empty/masked values on save do not overwrite existing keys
- **Session isolation**: Each conversation session maintains an independent ASR text buffer; switching does not lose context

---

## 3. ASR Engine Comparison

| | Browser Native (default) | DashScope |
|---|---|---|
| Implementation | Pure browser `SpeechRecognition` | `getUserMedia` -> PCM -> WS -> backend relay -> DashScope |
| Backend needed? | No | Yes (standalone WS service + REST API) |
| API Key needed? | No | Yes (Alibaba Cloud DashScope) |
| Browser requirement | Chrome / Edge (Web Speech API support) | Any modern browser (requires `getUserMedia`) |
| Chinese recognition | Moderate | Excellent |
| Chinese-English mixed | Moderate | Excellent |
| Auto punctuation | No | Yes |
| Streaming results | ✅ (`interimResults: true`) | ✅ (`streaming: "duplex"`) |
| User setup | Zero config | Configure API Key + select DashScope |

> Both engines produce identical streaming intermediate result behavior—cumulative incremental updates. `voice-engines.js`'s `emitResult()` handles them uniformly; the state machine in `voice-state.js` is engine-agnostic.

**Engine selection logic** (`createEngine()`):

```js
var isDs = cfg.asr && cfg.asr.provider === "dashscope";
return isDs ? f.createDashScopeEngine() : f.createBrowserEngine();
```

---

## 4. Frontend Design

### 4.1 Design Principles

- **Self-contained IIFE modules**: Each JS file uses IIFE encapsulation; shares internal interfaces via `window.VoiceCore._s` (state) and `window.VoiceCore._f` (functions)
- **Three global namespaces**:
  - `window.VoiceInput` - shared dependencies (cfg / defs / t / ext / formatShortcut / saveConfig)
  - `window.VoiceCore` - core public API (recording control, mode switching, UI creation)
  - `window.VoiceSettings` - settings panel API
- **CSS isolation**: Styles injected dynamically via `voice-ui.js` as a `<style id="voice-core-style">` tag; does not modify OpenClacky's `app.css`; uses CSS variables consistent with the platform
- **Self-contained i18n**: Bilingual dictionary embedded in `view.js`'s `DICT` object with its own `t()` function; does not depend on OpenClacky's `I18n.t()`

### 4.2 Module Architecture and Loading Chain

`view.js` serves as the entry point, responsible for dynamically loading sub-modules. Loading strategy:

```
view.js
  │
  ├── Parallel load settings-panel.js -> window.VoiceSettings
  │
  └── Chained load voice modules (strict order):
      voice-core.js   -> Creates VoiceCore namespace (_s state + _f function registry)
      voice-state.js   -> Registers to _f: text processing, session isolation, edit detection
      voice-audio.js   -> Registers to _f: sound playback
      voice-engines.js  -> Registers to _f: engine factory, result dispatch, silence detection, auto-send
      voice-ui.js      -> Registers to _f: CSS injection, button UI, timer, shortcut matching
      -> VoiceCore._ready = true -> triggers initApp()
```

**Loading protection mechanisms**:
- 10-second timeout per sub-module; on timeout, skips and continues loading without blocking the entire extension
- `onerror` callback also skips, ensuring a single module failure doesn't affect others
- Version stamp `?v=Date.now()` prevents browser caching of stale sub-modules

### 4.3 VoiceCore Public API

`window.VoiceCore` is the frontend core entry point. The following methods are callable from the console and external scripts:

| API | Type | Description |
|-----|------|-------------|
| `VoiceCore.init()` | method | Initialize: build exit phrases, mount Composer UI, register global shortcut listener, update browser support detection |
| `VoiceCore.startRecording()` | async method | Start recording: check browser support -> `gen++` -> create engine -> play start sound -> start timer |
| `VoiceCore.stopRecording()` | method | Stop recording: stop engine -> play stop sound -> clear timer -> update UI |
| `VoiceCore.toggleRecording()` | method | Toggle recording state (start ↔ stop) |
| `VoiceCore.setVoiceMode(on)` | method | Enable/disable hands-free mode; enabling auto-starts recording if idle, disabling stops recording if active |
| `VoiceCore.createComposerUI()` | method | Create the Composer UI above the input box (mic button + status text + browser warning) |
| `VoiceCore.updateAllBtnUI()` | method | Update all buttons' state, styling, and title attributes |
| `VoiceCore.checkExit(text)` | method | Exit word detection: returns `true` and triggers `stopRecording()` on match |
| `VoiceCore.buildExitPhrases()` | method | Build exit word array from config |
| `VoiceCore.updateBrowserWarning()` | method | Detect browser Web Speech API support; show/hide warning banner |

**Shared state object** `VoiceCore._s` (device-level + session-level):

```
Device-level (cross-session): listening, voiceMode, engine, gen, retryCount, silenceTimer, exitPhrases
Session-level:                sessionBuffers, activeSessionId, asrState, lastDisplay, editState
UI references:                composerBtn, composerStatus, errorToast, browserWarningBtn
Timers:                       recordingStartTime, recordingTimerId
```

**`gen` generation mechanism**: Each recording start increments `gen++`. The engine's internal closure saves `myGen`; callbacks check `s.gen === myGen` to ensure only the current recording round's results are processed, preventing stale engine async callbacks from interfering.

### 4.4 Two Voice Modes

Toggled via `VoiceCore.setVoiceMode(on)`, state stored in `s.voiceMode`:

| Mode | Activation | Button appearance | Behavior |
|------|-----------|-------------------|----------|
| **Push-to-Talk** | Default; shortcut `Ctrl+Shift+Z` or click mic | Red gradient + `viMicPulse` pulse animation (1.5s) while recording | Click to start recording, click again to stop; text stays in input box, manually sent |
| **Hands-Free** | Shortcut `Ctrl+Shift+M` or `setVoiceMode(true)` | Purple gradient + `viBreath` breathing animation (2s) while recording | Continuous listening; auto-sends current sentence after `silence_timeout_ms` of silence, then auto-restarts listening |

**Mode switching logic**:
- Push-to-Talk -> Hands-Free: auto-starts recording if not already recording
- Hands-Free -> Push-to-Talk: stops recording if currently active

**Auto-reconnect and retry mechanism** (Hands-Free mode):

| Engine | Trigger condition | Retry strategy |
|--------|-----------------|----------------|
| Browser native | `onend` triggered by browser silence auto-stop | Rebuild engine after `voice_mode_restart_delay_ms` delay; on failure, exponential backoff retry, max 3 attempts |
| DashScope | WS `onclose` (abnormal close code) | `retryCount++`, delay `baseDelay × 1.5^(retryCount-1)` before reconnecting; max 3 attempts |

> `retryCount` is only reset to 0 on user manual actions (`toggleRecording` / shortcut).

### 4.5 DashScope Engine Implementation Details

```
getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 } })
    ↓
AudioContext({ sampleRate: 16000 })
    ↓
createMediaStreamSource(stream) -> createScriptProcessor(4096, 1, 1)
    ↓
onaudioprocess: Float32 -> Int16 PCM conversion -> ws.send(pcm.buffer)
    ↓
Standalone WebSocket service -> wss://dashscope.aliyuncs.com/api-ws/v1/inference/
```

**Initialization handshake** (WS `onopen`):

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

**Finish handshake** (sent on `stop()`):

```json
{
  "header": { "task_id": "voice-<timestamp>", "action": "finish-task", "streaming": "duplex" },
  "payload": { "input": {} }
}
```

**Port acquisition**: Frontend first calls `GET /api/ext/voice-input/ws-port` to obtain the standalone WS service address (`ws://127.0.0.1:<port>`), then connects directly.

### 4.6 Configuration (config.default.yml)

The sole default configuration source is `config.default.yml`, read uniformly by both frontend and backend. `view.js` contains a hardcoded fallback (used only when the API is unreachable).

```yaml
asr:
  provider: google              # google | dashscope
  model: paraformer-realtime-v1 # DashScope model
language: zh-CN                 # BCP-47 language tag (zh-CN | en-US)
shortcuts:
  toggle:     { modifiers: [Control, Shift], key: z }   # Start/stop
  stop:       { modifiers: [Control, Shift], key: s }   # Stop
  start:      { modifiers: [Control, Shift], key: r }   # Start
  voice_mode: { modifiers: [Control, Shift], key: m }   # Toggle mode
exit_words: [拜拜, 结束语音交互, 退出语音交互, 关闭语音, 再见, byebye]
silence_timeout_ms: 1500              # Hands-free mode silence timeout (ms)
voice_mode_restart_delay_ms: 300      # Voice mode auto-restart delay (ms)
default_mode: push-to-talk            # Initial mode: push-to-talk | hands-free
sound:
  start: default                      # Start sound (default | none | filename)
  stop: default                        # Stop sound
  volume: 0.4                          # Volume 0.0 ~ 1.0
```

**Config loading and persistence flow**:

```
Frontend view.js loadConfig()
  -> GET /api/ext/voice-input/config (returns masked config)
  -> deepMerge(defs, serverConfig) -> window.VoiceInput.cfg

Frontend view.js saveConfig(partial)
  -> PUT /api/ext/voice-input/config { config: partial }
  -> Backend validates + saves + API Key validity check
  -> Returns { success: true, config: <masked>, warnings?: [...] }
  -> Frontend deepMerge updates cfg
```

### 4.7 UI Design

Composer UI is mounted above the input box (via `Clacky.ext.ui.mount("session.composer", ...)`):

```
┌──────────────────────────────────────────────────────────────┐
│ [🎤 Voice] [status text]                          [timer]     │
│                                                               │
│ Idle: gray border                                             │
│ Push-to-Talk recording: red gradient + viMicPulse (1.5s)      │
│ Hands-free recording:   purple gradient + viBreath (2s)       │
│ Unsupported browser: dashed border (.voice-disabled) + warning│
│ hover: brand accent color                                     │
└──────────────────────────────────────────────────────────────┘
```

**Button state class toggling**:

| Class | Condition | Visual effect |
|-------|-----------|---------------|
| `.voice-mic-btn.recording` | Push-to-Talk recording | Red gradient + `viMicPulse` animation |
| `.voice-mic-btn.voice-mode` | Hands-free recording | Purple gradient + `viBreath` animation |
| `.voice-mic-btn.voice-disabled` | Browser unsupported | Dashed border + reduced opacity |

**Recording timer**: On recording start, `recordingStartTime` is recorded; display updates every second in `mm:ss` format.

### 4.8 CSS Styling

Styles are injected dynamically by `voice-ui.js` via a `<style id="voice-core-style">` tag, not in OpenClacky's `app.css`.

**Design highlights**:
- Uses CSS variables consistent with the OpenClacky platform (`--color-accent-primary`, `--color-border-primary`, `--color-bg-primary`, etc.)
- No new color constants; all reference platform variables
- Animation definitions:

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

### 4.9 i18n

Self-contained bilingual dictionary embedded in `view.js`'s `DICT` object:

- **Language detection**: Via `window.Clacky.I18n.lang()`, defaults to `zh`
- **Translation function**: `t(key, params)` - looks up current language dictionary first, falls back to `en`, then to the raw key
- **Parameter substitution**: Supports `{param}` template replacement (e.g., `{sounds_dir}`, `{engine}`, `{file}`)
- **Dynamic switching**: Listens for `langchange` events; refreshes UI on language change
- **Does not depend on** OpenClacky's `I18n.t()` / `data-i18n` mechanism

### 4.10 Sound Effect System

Sound playback handled by `voice-audio.js`, two modes:

| Sound value | Playback method |
|-------------|----------------|
| `default` | Web Audio API oscillator: start 880Hz/150ms, stop 440Hz/250ms |
| `none` | Silent |
| Filename | `new Audio("/api/ext/voice-input/sounds/<filename>")` loaded from `~/.clacky/sounds/` |

Volume controlled via `sound.volume` (0.0 ~ 1.0), default 0.4.

### 4.11 Text State Management and Session Isolation

`voice-state.js` manages the ASR text lifecycle:

**State machine** (`editState` field):

| State | Meaning | Trigger |
|-------|---------|---------|
| `clean` | Input box content matches ASR output | Normal recognition flow |
| `editing` | User manually modified the input box | `oninput` event detected `val !== lastDisplay` |
| `cleared` | User cleared the input box | `oninput` detected empty value |

**Edit absorption mechanism**: When a `isFinal` result arrives and `editState === "editing"`, `absorbEditsForFinal()` merges the user's manual edits into the ASR queue. New results are appended after the user's edits, never overwriting them.

**Session isolation**: `sessionBuffers[sessionId]` maintains an independent ASR state per conversation session. Switching sessions saves the current context; switching back restores it.

---

## 5. Backend Design

### 5.1 REST API Routes

All routes mounted under `/api/ext/voice-input/`, provided by `handler.rb`:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Returns extension info (name, version, status message) |
| GET | `/config` | Read config; API Key masked before returning (`sk-a****b7e2` format) |
| PUT | `/config` | Save config; includes validation, API Key validity check, sound file existence check; returns masked config + warnings list |
| GET | `/ws-port` | Get standalone WebSocket service address (`{ host: "127.0.0.1", port: <N>, running: true }`) |
| GET | `/sounds/:filename` | Serve custom sound files (from `~/.clacky/sounds/`, with path traversal protection) |

**PUT /config save logic**:

```
1. Read existing config
2. Merge incoming fields (scalar keys + asr + sound + shortcuts + exit_words)
3. API Key protection: empty/masked values (containing ****) do not overwrite existing key
4. Validate: default_mode enum, silence_timeout_ms >= 0, volume ∈ [0,1]
5. Save to config.yml
6. Non-blocking checks:
   a. Sound file existence (~/.clacky/sounds/)
   b. DashScope API Key validity (GET dashscope.aliyuncs.com/compatible-mode/v1/models)
7. Return masked config + warnings[]
```

### 5.2 Standalone WebSocket Service (ws_server.rb)

Does not depend on OpenClacky internal routing; provides DashScope ASR relay on an independent TCP port.

**Startup flow**:

```
handler.rb load time -> VoiceInputWsServer.start(host: "127.0.0.1", port: 0)
  -> TCPServer.new -> OS assigns random port -> @port = server.addr[1]
  -> Thread.new { loop { accept -> Thread.new { handle_client } } }
```

**Single connection handling flow**:

```
1. read_http_request(socket, 5s timeout)
   -> Read HTTP upgrade request (non-blocking + IO.select timeout)

2. WebSocket::Handshake::Server parse handshake
   -> Validate

3. Load config (config_manager.load_config_file)
   -> Read API Key (with ~/.clacky/voice-config.yml fallback)
   -> If no API Key -> fail_handshake (complete 101 first, then send close frame)

4. Send 101 Switching Protocols (complete handshake first to avoid client timeout)

5. open_upstream(uri, headers)
   -> TCPSocket -> OpenSSL::SSL::SSLSocket -> WebSocket::Handshake::Client
   -> Connect to wss://dashscope.aliyuncs.com/api-ws/v1/inference/
   -> Attach Authorization: bearer <api_key>

6. relay(browser_socket, upstream_socket)
   -> IO.select([browser, upstream], nil, nil, 30)
   -> Browser->upstream: decode WS frames -> forward text/binary
   -> Upstream->browser: decode WS frames -> forward text/binary
   -> Handle ping/pong/close frame types
```

**Technology choices**:

| Component | Choice | Rationale |
|-----------|--------|-----------|
| TCP service | `TCPServer` (Ruby stdlib) | Zero extra dependencies |
| TLS | `OpenSSL::SSL::SSLContext` (Ruby stdlib) | Supports wss:// |
| WS handshake/frame | `websocket` gem | Already depended on by ext.yml api handler |
| Concurrency | Thread-per-connection | Simple, reliable, low connection count |

**Security considerations**:
- Binds to `127.0.0.1`, not exposed to external networks
- API Key log masking (only first 4 and last 4 characters)
- Non-blocking IO + timeout protection (handshake 5s, upstream connect 10s, relay 30s select timeout)
- Pre-allocated BINARY buffers to avoid `websocket` gem's `Encoding::CompatibilityError`

### 5.3 Config Management (config_manager.rb)

**Config hierarchy**:

```
config.default.yml    <- Sole default config source (read by frontend and backend)
       ↓
config.yml           <- User config (extension directory, auto-created from defaults on first launch)
       ↓ (fallback when API Key is empty)
~/.clacky/voice-config.yml  <- Fallback config (backward compatibility with legacy OpenClacky core integration)
```

**API Key protection mechanism**:

- `GET /config`: Calls `mask_api_key()` before returning; the raw key is never sent to the frontend
- `PUT /config`: If the incoming key is empty or contains `****`, preserves the existing real key in config.yml
- `mask_api_key(key)`: Length < 8 returns `"****"`, otherwise `key[0..3] + "****" + key[-4..]`

**Config validation** (`validate_patch_config!`):

- `default_mode` must be `push-to-talk` or `hands-free`
- `silence_timeout_ms` must be ≥ 0
- `sound.volume` must be ∈ [0.0, 1.0]

**Hardcoded fallback**: `HARDCODED_DEFAULTS` constant, used only as a safety net when `config.default.yml` is unreadable.

### 5.4 Security Considerations

- **API Key non-exposure**: Stored only in server-side `config.yml`; frontend always receives masked values via `mask_api_key()`
- **API Key validity check**: On save, asynchronously requests DashScope API to validate (5s timeout); invalid keys return a warning but do not block saving
- **Path traversal protection**: `/sounds/:filename` endpoint checks `filepath.start_with?(sounds_dir)` to prevent `../` attacks
- **Local binding**: WebSocket service binds to `127.0.0.1`, does not accept external connections
- **Log masking**: API Key in logs shows only first 4 and last 4 characters

---

## 6. File Structure

```
voice-input/
├── ext.yml                        # Extension manifest (id, version, contributes: api + panels)
├── config.yml                     # User config (generated/modified at runtime)
├── config.default.yml             # Default config (sole default source, read by frontend and backend)
├── README.md                      # User documentation
├── docs/
│   ├── voice-input-proposal.md       # Technical proposal (English, this document)
│   └── voice-input-proposal-zh.md    # Technical proposal (Chinese)
├── api/
│   ├── handler.rb                 # REST API routes (~172 lines)
│   ├── config_manager.rb          # Config management module (~167 lines)
│   └── ws_server.rb               # Standalone WebSocket ASR relay service (~402 lines)
└── panels/voice-btn/
    ├── view.js                    # Entry: i18n dictionary, config loading, sub-module loading chain, mounting (~427 lines)
    ├── voice-core.js              # Core: namespace, shared state, recording control, public API (~219 lines)
    ├── voice-state.js             # State: ASR text management, session isolation, edit detection (~173 lines)
    ├── voice-audio.js             # Audio: recording start/stop sound effects (~71 lines)
    ├── voice-engines.js           # Engines: browser native + DashScope dual engine factory (~409 lines)
    ├── voice-ui.js                # UI: CSS injection, Composer button, state updates, timer (~229 lines)
    └── settings-panel.js          # Settings panel: UI building, config changes, warning banners (~620 lines)
```

