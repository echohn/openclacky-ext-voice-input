# Voice Input Extension

[中文](../README.md)

Speak and have your voice automatically transcribed into the input box. Supports two interaction modes — Push-to-Talk and Hands-Free Continuous Conversation — with a visual settings panel and bilingual UI in both Chinese and English.

> 📌 **Feedback & Suggestions**: Please open an issue in the [GitHub repository](https://github.com/echohn/openclacky-ext-voice-input) to report bugs or request features.

---

## What Is This

This extension lets you **talk instead of type**. Click the microphone button above the input box, and your speech will be transcribed into the chat input in real time. Send it when you’re done.

Core capabilities:

- **Real-time speech recognition** — words appear as you speak, no need to wait for the recording to finish
- **Two interaction modes** — Push-to-Talk (record one segment and send) or Hands-Free (continuous dictation with auto-send)
- **Global shortcuts** — control recording from anywhere with your keyboard, hands stay on the keyboard
- **Exit-word detection** — say a preset word (e.g., “byebye”) to stop recording automatically
- **Per-session isolation** — voice context is isolated between conversations and restored on switch
- **Custom sound effects** — start/end sounds for recording, with support for custom audio files
- **Bilingual UI** — automatically follows the OpenClacky language setting

By default, it uses the browser’s built-in speech recognition, so it works out of the box with zero configuration. You can also switch to the Alibaba Cloud DashScope engine in Settings for better accuracy. See the [engine comparison](#engine-comparison) below.

---

## Quick Start

### Step 1: Install the Extension

Once installed, a **🎤 Voice Input** button automatically appears above the input box.

### Step 2: Start Recording

Click the **🎤 Voice Input** button (or press `Ctrl+Shift+Z`). The button turns red and shows a recording timer; start speaking.

### Step 3: View the Result

Text appears in the input box as you speak. Click the button again to stop recording; the text remains in the input box for editing before you send it.

### Step 4: Switch to Hands-Free Mode (Optional)

Press `Ctrl+Shift+M` to switch to Hands-Free Continuous Conversation mode. After each sentence, the extension pauses and automatically sends the message, so you don’t have to click repeatedly.

---

## Two Interaction Modes

| Mode | Description | Best For |
|------|-------------|----------|
| **Push-to-Talk** | Click the mic to start, click again to stop. After stopping, the text stays in the input box for editing and manual sending. | Dictating long paragraphs that need review before sending |
| **Hands-Free** | Keeps listening continuously. When a pause is detected, the current sentence is sent automatically, and listening resumes for the next turn. | Multi-turn back-and-forth conversation without using your hands |

> Choose the default mode in the settings panel, or press `Ctrl+Shift+M` to toggle at any time.

---

## Engine Comparison

The extension uses the browser’s native speech recognition engine by default, so it works out of the box with zero configuration. If you need better recognition quality, switch to the Alibaba Cloud DashScope engine in Settings.

| | Browser Native (default) | DashScope |
|---|---|---|
| **Configuration** | Zero setup, works out of the box | Requires an Alibaba Cloud API Key |
| **Browser requirements** | Chrome / Edge (must support the Web Speech API) | Any modern browser |
| **Punctuation** | None | Auto-added |
| **Chinese recognition** | Moderate | Excellent |
| **Mixed Chinese / English** | Moderate | Excellent |
| **Network dependency** | Relies on Google services | Relies on Alibaba Cloud services |
| **Sign-up link** | — | [DashScope Console](https://dashscope.console.aliyun.com/) |

> If your browser doesn’t support the Web Speech API, a `⚠️ Browser not supported → Switch to DashScope` hint appears above the input box. Click it to switch in one step.

---

## Settings Panel

In OpenClacky, open **Settings** and click the **“Voice Input”** tab.

![Voice Input Settings Panel](./images/settings-panel-zh.png)

> The screenshot above shows the Voice Input settings panel in the Chinese UI. It contains recognition engine, recognition language, default mode, shortcuts, exit words, sound effects, and timing parameters.

### Recognition Engine

Choose the speech recognition engine: **Browser Native** or **DashScope**. Selecting DashScope reveals an API Key input field.

- The API Key is masked on display (e.g., `sk-a****b7e2`), and the backend validates it automatically.
- If the API Key is invalid when saving, a yellow warning appears at the top of the panel.

### Recognition Language

Switch between Chinese (`zh-CN`) and English (`en-US`) recognition.

### Default Mode

Set the default mode on startup: **Push-to-Talk** or **Hands-Free**.

### Shortcuts

Four global shortcuts. Click an input field and press a new key combination to rebind it.

| Name | Default Shortcut | Function |
|------|------------------|----------|
| Start / Stop | `Ctrl+Shift+Z` | Toggle recording state |
| Stop | `Ctrl+Shift+S` | Stop recording only |
| Start | `Ctrl+Shift+R` | Start recording only |
| Toggle Mode | `Ctrl+Shift+M` | Switch between Push-to-Talk and Hands-Free |

> On macOS, `Ctrl` is shown as `⌃` and `Shift` as `⇧`. Shortcuts work globally on any page (except when the input box is focused).

### Exit Words

Set voice exit words, one per line. Saying any of them automatically stops recording.

Default exit words: `拜拜`, `结束语音交互`, `退出语音交互`, `关闭语音`, `再见`, `byebye`

> Exit words should match the recognition language. Use Chinese exit words for the Chinese engine and English exit words for the English engine.

### Button Position

To keep a consistent visual style with other extension buttons, the voice input button uses the standard style by default. Users can customize its vertical position and load order through the settings below.

Controls the vertical alignment of the voice input button inside the input box area.

| Option | Effect |
|--------|--------|
| `top` | Align the button to the top |
| `center` | Align the button to the center |
| `bottom` | Align the button to the bottom (default) |

### Load Order

When multiple extensions occupy the input box area at the same time, adjusting the load order controls the left-to-right arrangement of the extension buttons. A larger number places the button farther to the right. If only one extension is loaded in this area, this setting has no effect.

- **Default value**: `5`
- Decrease the value to move the button to the left, or increase it to move it to the right.
- **Refresh the page** after changing this setting for it to take effect.

### Sound Effects

Configure the sounds played when recording starts and ends.

| Value | Effect |
|-------|--------|
| `default` | Built-in electronic beep (880 Hz start / 440 Hz end) |
| `none` | Silent, no sound |
| File name | Custom sound, e.g., `voice-start.mp3` |

Custom sound files should be placed in `~/.clacky/sounds/`. Supported formats: mp3, wav, ogg, aac, m4a, flac, webm.

The volume slider controls the prompt volume (0.0 ~ 1.0).

### Timing Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| Silence timeout | 1500 ms | In Hands-Free mode, if speech pauses longer than this, the current sentence is sent automatically. |
| Reconnect delay | 300 ms | After the browser ASR stops automatically due to silence, wait this long before resuming listening. |

> The silence timeout only affects **Hands-Free** mode. **Push-to-Talk** mode is not affected by this setting.

---

## FAQ

### The mic button says “Browser not supported”

Your browser does not support the Web Speech API. Switch to Chrome or Edge, or change the engine to **DashScope** in Settings (which does not depend on browser APIs).

### Microphone permission was denied

Click the lock icon in the browser address bar → Site settings → Microphone → Allow, then refresh the page.

### DashScope says “API Key not configured”

Go to **Settings → Voice Input → Recognition Engine**, select DashScope, and enter your Alibaba Cloud DashScope API Key. You can apply for a key in the [Alibaba Cloud DashScope Console](https://dashscope.console.aliyun.com/).

### Hands-Free mode does not auto-send

Check the **Silence timeout** setting. A larger value means you need to pause longer before the message is sent automatically. The default is 1500 ms (1.5 seconds); you can reduce it if needed.

### Speech recognition suddenly stops

The browser native engine stops automatically after long silence. The extension will reconnect automatically (up to 3 retries). If interruptions happen often, switch to the DashScope engine, which is more stable.

### Will manually editing the input box while recording lose my changes?

No. The extension detects your manual edits and absorbs them — the next recognition result will be appended after your edited text instead of overwriting it.

### Is voice content preserved when switching sessions?

Yes. Each session has an independent voice buffer. When you switch to another session, the current session’s context is saved automatically and restored when you return.

---

## Usage Tips

- **First-time users: start with the browser native engine.** Zero configuration, and you can experience Google Web Speech API right away.
- **Need punctuation? Switch to DashScope.** The browser native engine does not add punctuation; DashScope adds commas and periods automatically.
- **Hands-Free mode is great for long dictation.** Keep talking; each sentence is sent automatically after a brief pause, without repeated clicks.
- **Exit words make voice control feel natural.** Just say “拜拜” when you’re done — no need to reach for the button.
- **Customize shortcuts to avoid conflicts.** If the default shortcuts clash with another tool, rebind them in Settings.
- **Adjust the silence timeout to your speaking pace.** Increase it if you speak slowly (e.g., 2000 ms), or decrease it if you speak quickly (e.g., 1000 ms).
- **Your API Key is kept safe.** The key is stored only in the local configuration file, always masked in the UI, and never leaked.
