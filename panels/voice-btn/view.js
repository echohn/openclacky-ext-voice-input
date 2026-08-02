// voice-input 扩展 — 语音输入（入口 — 组装挂载）
//
// 职责：
//   1. 合并 i18n 词典，提供 t() 给两个子模块
//   2. 初始化共享配置 cfg，挂 window.VoiceInput.cfg
//   3. 加载/持久化配置
//   4. 分别挂载 session.composer、settings.tabs、settings.body
//
// 全局命名空间（参考 openclacky 的 window.Clacky 模式）：
//   window.VoiceInput    - 共享依赖（cfg/defs/t/ext 等）
//   window.VoiceCore     - 语音核心公共 API
//   window.VoiceSettings - 设置面板公共 API

// 子模块（动态加载，驻留在同目录）：
//   settings-panel.js → window.VoiceSettings
//   voice-core.js    → window.VoiceCore (主模块)
//   voice-state.js   → VoiceCore._f (状态/文本/会话)
//   voice-audio.js   → VoiceCore._f (音效)
//   voice-engines.js → VoiceCore._f (ASR引擎)
//   voice-ui.js      → VoiceCore._f (UI)
(function () {
  "use strict";
  if (!window.Clacky || !Clacky.ext) return;

  // ── 获取当前脚本所在目录，推导子模块路径 ──
  var currentScript = document.currentScript;
  var basePath = currentScript ? currentScript.src.replace(/view\.js(\?.*)?$/, "") : "";

  // ── 动态加载子模块，加载完成后执行 initApp ──
  function loadSubModules(callback) {
    // voice-core.js 创建 VoiceCore 命名空间，其余子模块向其注册函数
    if (window.VoiceSettings && window.VoiceCore && VoiceCore._ready) {
      callback();
      return;
    }

    var settingsLoaded = false;
    function onSettingsLoad() {
      settingsLoaded = true;
      checkAllDone();
    }

    function checkAllDone() {
      if (settingsLoaded && VoiceCore._ready) callback();
    }

    // 加载 settings-panel.js（与 voice 模块并行）
    var sSettings = document.createElement("script");
    sSettings.src = basePath + "settings-panel.js?v=" + Date.now();
    sSettings.onload = onSettingsLoad;
    sSettings.onerror = onSettingsLoad;
    document.head.appendChild(sSettings);

    // 链式加载 voice 模块文件（确保 voice-core.js 先执行创建命名空间）
    var voiceFiles = [
      "voice-core.js",
      "voice-state.js",
      "voice-audio.js",
      "voice-engines.js",
      "voice-ui.js",
    ];
    function loadVoiceModules(idx) {
      if (idx >= voiceFiles.length) {
        VoiceCore._ready = true;
        checkAllDone();
        return;
      }
      var script = document.createElement("script");
      script.src = basePath + voiceFiles[idx] + "?v=" + Date.now();
      var loaded = false;
      // 10s 超时保护：script 卡在 pending 时不至于永久挂起整个扩展
      var timeout = setTimeout(function () {
        if (!loaded) {
          console.error("[voice-input] 加载超时:", voiceFiles[idx]);
          loadVoiceModules(idx + 1);
        }
      }, 10000);
      script.onload = function () {
        loaded = true;
        clearTimeout(timeout);
        loadVoiceModules(idx + 1);
      };
      script.onerror = function () {
        loaded = true;
        clearTimeout(timeout);
        console.error("[voice-input] 加载失败:", voiceFiles[idx]);
        loadVoiceModules(idx + 1);
      };
      document.head.appendChild(script);
    }
    loadVoiceModules(0);
  }

  // ═══════════════════════════════════════════════════════════════════
  // 以下为 view.js 主体逻辑，子模块加载完成后执行
  // ═══════════════════════════════════════════════════════════════════
  function initApp() {
    // ── 1. i18n（合并词典，跨两模块共享）──
    var DICT = {
      zh: {
        // ── Composer（voice-core 使用）──
        "composer.mic_label": "语音输入",
        "composer.recording": "录音中",
        "composer.voice_mode": "语音模式",
        "composer.stop": "停止",
        "composer.click_stop": "点击停止",
        "composer.voice_mode_btn": "AI 对话中",
        "composer.unsupported": "浏览器不支持语音识别，建议使用 Chrome 或 Edge。",
        "composer.unsupported_short": "浏览器不支持",
        "composer.mic_denied": "麦克风权限被拒绝，请在浏览器设置中允许后刷新页面。",
        "composer.api_key_missing": "DashScope API Key 未配置",
        "composer.check_settings": "请前往设置页查看",
        "composer.browser_warning_link": "⚠️ 浏览器不支持 → 切换 DashScope",
        "composer.title_unsupported": "请使用 Chrome 或 Edge",
        // ── Panel（voice-core 使用）──
        "panel.title": "语音输入",
        "panel.start": "🎤 开始录音",
        "panel.stop": "停止录音",
        "panel.idle": "点击按钮开始录音",
        "panel.recording": "正在录音中，请说话...",
        "panel.copy": "复制到剪贴板",
        "panel.copied": "已复制 ✓",
        "panel.selected": "已选中，Cmd+C 复制",
        "panel.hint": "快捷键: Ctrl+Shift+Z 开始/停止 | 点击 ▶ 语音设置 调整参数",
        "panel.settings_toggle": "语音设置",
        "panel.result_placeholder": "点击麦克风开始录音，实时结果将显示在这里",
        // ── Browser warning（voice-core 使用）──
        "browser.warning": "<strong>⚠️ 浏览器不支持 Web Speech API</strong><br>您当前选择了「{engine}」引擎，但此浏览器不支持 Google Web Speech Recognition。请在下方语音设置中切换到 <strong>DashScope</strong> 引擎（需配置 API Key），或使用 Chrome / Edge 浏览器。",
        // ── Settings（settings-panel 使用）──
        "settings.engine": "识别引擎",
        "settings.engine.browser": "浏览器原生",
        "settings.engine.dashscope": "DashScope",
        "settings.engine.desc": "浏览器原生：使用 Google Web Speech API，零配置，推荐 Chrome/Edge，不含标点。<br>DashScope：阿里云 Paraformer 实时识别，需 API Key，不依赖浏览器，自动加标点。",
        "settings.apikey": "API Key",
        "settings.language": "识别语言",
        "settings.lang.zh": "中文",
        "settings.lang.en": "English",
        "settings.mode": "默认模式",
        "settings.mode.push": "点击发送",
        "settings.mode.handsfree": "连续对话",
        "settings.mode.desc": "点击发送：点击麦克风开始 / 停止录音，停止后文字留在输入框。<br>连续对话：持续识别，检测到静音后自动发送。",
        "settings.shortcuts": "快捷键",
        "settings.shortcuts.toggle": "开始/停止",
        "settings.shortcuts.stop": "停止",
        "settings.shortcuts.start": "开始",
        "settings.shortcuts.voice_mode": "切换模式",
        "settings.shortcuts.desc": "全局快捷键，在任意页面按下组合键即可控制录音。修改下方字母即可自定义快捷键。",
        "settings.exit_words": "退出词",
        "settings.exit_words.label": "退出词",
        "settings.exit_words.placeholder": "每行一个退出词\n拜拜\n结束语音交互",
        "settings.exit_words.desc": "说出任意一行设定的词语，将自动停止录音。每行一个退出词，需与所选识别语言一致。",
        "settings.sound": "音效",
        "settings.sound.start": "开始音",
        "settings.sound.stop": "停止音",
        "settings.sound.volume": "音量",
        "settings.sound.desc": "填文件名（如 voice-start.mp3）使用自定义音效，文件放在 {sounds_dir} 下。<br>填 <b>default</b> 使用内置电子音。<br>填 <b>none</b> 关闭提示音。",
        "settings.sound.file_not_found": "⚠ 音效文件 \"{file}\" 不存在，请确认文件已放入 {sounds_dir} 目录",
        "settings.timing": "时间参数",
        "settings.timing.silence": "静音超时(ms)",
        "settings.timing.restart": "重连延迟(ms)",
        "settings.timing.desc": "静音超时：说话停顿超过此时长（毫秒），自动结束当前句子并发送（连续对话）。<br>重连延迟：浏览器 ASR 因静音自动停止后，等待此时长再重新开始监听。",
        "settings.position": "按钮位置",
        "settings.position.label": "垂直位置",
        "settings.position.top": "靠上",
        "settings.position.center": "居中",
        "settings.position.bottom": "靠下",
        "settings.position.desc": "设置语音输入按钮在输入框区域内的垂直对齐方式。",
        "settings.order": "加载顺序"
      },
      en: {
        "composer.mic_label": "Voice",
        "composer.recording": "Recording",
        "composer.voice_mode": "Voice Mode",
        "composer.stop": "Stop",
        "composer.click_stop": "Tap to Stop",
        "composer.voice_mode_btn": "AI Chatting",
        "composer.unsupported": "Browser doesn't support speech recognition. Please use Chrome or Edge.",
        "composer.unsupported_short": "Unsupported",
        "composer.mic_denied": "Microphone access denied. Please allow it in browser settings and refresh.",
        "composer.api_key_missing": "DashScope API Key not configured",
        "composer.check_settings": "Check settings",
        "composer.browser_warning_link": "⚠️ Unsupported browser → Switch to DashScope",
        "composer.title_unsupported": "Please use Chrome or Edge",
        "panel.title": "Voice Input",
        "panel.start": "🎤 Start",
        "panel.stop": "Stop Recording",
        "panel.idle": "Click the button to start recording",
        "panel.recording": "Recording, please speak...",
        "panel.copy": "Copy to clipboard",
        "panel.copied": "Copied ✓",
        "panel.selected": "Selected, Cmd+C to copy",
        "panel.hint": "Shortcut: Ctrl+Shift+Z Toggle | Click ▶ Settings to configure",
        "panel.settings_toggle": "Settings",
        "panel.result_placeholder": "Click the microphone to start recording, real-time results will appear here",
        "browser.warning": "<strong>⚠️ Web Speech API not supported</strong><br>You selected \"{engine}\", but this browser doesn't support Google Web Speech Recognition. Switch to <strong>DashScope</strong> in settings below (requires API Key), or use Chrome / Edge.",
        "settings.engine": "Engine",
        "settings.engine.browser": "Browser (Web Speech)",
        "settings.engine.dashscope": "DashScope",
        "settings.engine.desc": "Browser: Google Web Speech API, zero config, works best on Chrome/Edge, no punctuation.<br>DashScope: Alibaba Cloud Paraformer real-time ASR, requires API Key, browser-independent, auto punctuation.",
        "settings.apikey": "API Key",
        "settings.language": "Language",
        "settings.lang.zh": "中文",
        "settings.lang.en": "English",
        "settings.mode": "Default Mode",
        "settings.mode.push": "Push To Talk",
        "settings.mode.handsfree": "Hands Free",
        "settings.mode.desc": "Push To Talk: click mic to start/stop. Text stays in input after stopping.<br>Hands Free: continuous recognition, auto-sends after silence detected.",
        "settings.shortcuts": "Shortcuts",
        "settings.shortcuts.toggle": "Toggle",
        "settings.shortcuts.stop": "Stop",
        "settings.shortcuts.start": "Start",
        "settings.shortcuts.voice_mode": "Toggle Mode",
        "settings.shortcuts.desc": "Global shortcuts — press the key combo anywhere to control recording. Change the letters below to customize.",
        "settings.exit_words": "Exit Words",
        "settings.exit_words.label": "Exit Words",
        "settings.exit_words.placeholder": "One word per line\nbye\nstop recording",
        "settings.exit_words.desc": "Say any of these words to stop recording automatically. Each line is one exit word. Must match the recognition language.",
        "settings.sound": "Sound",
        "settings.sound.start": "Start sound",
        "settings.sound.stop": "Stop sound",
        "settings.sound.volume": "Volume",
        "settings.sound.desc": "Enter a filename (e.g. voice-start.mp3) to use a custom sound from {sounds_dir}.<br>Use <b>default</b> for built-in electronic beep.<br>Use <b>none</b> to disable sounds.",
        "settings.sound.file_not_found": "⚠ Sound file \"{file}\" not found. Make sure it's in {sounds_dir}",
        "settings.timing": "Timing",
        "settings.timing.silence": "Silence timeout (ms)",
        "settings.timing.restart": "Reconnect delay (ms)",
        "settings.timing.desc": "Silence timeout: if speech pauses longer than this (ms), auto-finalize and send (hands-free mode).<br>Reconnect delay: after browser ASR auto-stops due to silence, wait this long before restarting.",
        "settings.position": "Button Position",
        "settings.position.label": "Vertical align",
        "settings.position.top": "Top",
        "settings.position.center": "Center",
        "settings.position.bottom": "Bottom",
        "settings.position.desc": "Vertical alignment of the voice input button within the composer area.",
        "settings.order": "Mount Order"
      }
    };

    function currentLang() {
      try {
        var I18n = (window.Clacky && window.Clacky.I18n) || window.I18n;
        var l = I18n && typeof I18n.lang === "function" ? I18n.lang() : null;
        return DICT[l] ? l : "zh";
      } catch (e) { return "zh"; }
    }

    // 获取音效目录路径提示（先尝试 API，失败则按平台推断）
    var _soundsDirHint = null;
    function getSoundsDirHint() {
      if (_soundsDirHint) return _soundsDirHint;
      try {
        var xhr = new XMLHttpRequest();
        xhr.open("GET", "/api/ext/" + EXT + "/sounds-path", false);
        xhr.send();
        if (xhr.status === 200) {
          var data = JSON.parse(xhr.responseText);
          _soundsDirHint = data.path || data;
          return _soundsDirHint;
        }
      } catch(e) {}
      // 降级：按平台推断
      var isWin = /Win/i.test(navigator.platform);
      _soundsDirHint = isWin ? "%USERPROFILE%\\.clacky\\sounds\\" : "~/.clacky/sounds/";
      return _soundsDirHint;
    }

    function t(key, params) {
      var dict = DICT[currentLang()] || DICT.en;
      var val = dict[key] || DICT.en[key] || key;
      if (params) {
        for (var p in params) {
          val = val.replace("{" + p + "}", params[p]);
        }
      }
      if (val.indexOf("{sounds_dir}") !== -1) {
        val = val.replace(/\{sounds_dir\}/g, getSoundsDirHint());
      }
      return val;
    }

    function onLangChange(handler) {
      document.addEventListener("langchange", handler);
      return function () { document.removeEventListener("langchange", handler); };
    }

    // ── 2. 全局配置（两模块共享）──
    // 注意：此处的 defs 是前端硬编码兜底值。默认配置的唯一源是 config.default.yml，
    // 如需修改默认值，请同步更新 config.default.yml（后端会自动读取）。
    var EXT  = "voice-input";
    var defs = {
      asr: { provider: "google", api_key: "" },
      language: "zh-CN",
      shortcuts: {
        toggle:     { modifiers: ["Control","Shift"], key: "z" },
        stop:       { modifiers: ["Control","Shift"], key: "s" },
        start:      { modifiers: ["Control","Shift"], key: "r" },
        voice_mode: { modifiers: ["Control","Shift"], key: "m" }
      },
      exit_words: ["拜拜", "结束语音交互", "退出语音交互", "关闭语音", "再见", "byebye"],
      silence_timeout_ms: 1500,
      voice_mode_restart_delay_ms: 300,
      default_mode: "push-to-talk",
      sound: { start: "default", stop: "default", volume: 0.4 },
      ui: { composer_align: "bottom", composer_order: 5 }
    };
    var cfg = JSON.parse(JSON.stringify(defs));

    // ── 3. 工具函数 ──
    function deepMerge(target, source) {
      var out = JSON.parse(JSON.stringify(target));
      return deepMergeInto(out, source);
    }
    function deepMergeInto(target, source) {
      for (var key in source) {
        if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
          target[key] = target[key] || {};
          deepMergeInto(target[key], source[key]);
        } else {
          target[key] = source[key];
        }
      }
      return target;
    }

    function formatShortcut(sc) {
      if (!sc || !sc.key) return "";
      var parts = [];
      var isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      var mods = sc.modifiers || [];
      if (mods.indexOf("Control") >= 0) parts.push(isMac ? "⌃" : "Ctrl");
      if (mods.indexOf("Shift") >= 0)   parts.push(isMac ? "⇧" : "Shift");
      if (mods.indexOf("Alt") >= 0)     parts.push(isMac ? "⌥" : "Alt");
      if (mods.indexOf("Meta") >= 0)    parts.push(isMac ? "⌘" : "Meta");
      var key = sc.key;
      if (key.length === 1) key = key.toUpperCase();
      else if (key === " ") key = "Space";
      parts.push(key);
      return parts.join("+");
    }

    // ── 4. 配置持久化 ──
    async function saveConfig(partial) {
      try {
        var res = await fetch("/api/ext/" + EXT + "/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config: partial })
        });
        var data = await res.json();
        // 兼容旧格式 {ok, config} 和新格式 {success, warnings}
        if ((data.ok || data.success) && data.config) {
          cfg = deepMerge(cfg, data.config);
          window.VoiceInput.cfg = cfg;
        }
        return data; // 返回完整响应，供调用方取 warnings
      } catch (e) { console.error("[voice-input] saveConfig failed:", e); return null; }
    }

    async function loadConfig() {
      try {
        var res = await fetch("/api/ext/" + EXT + "/config");
        var data = await res.json();
        if (data.ok && data.config) {
          cfg = deepMerge(defs, data.config);
          window.VoiceInput.cfg = cfg;
        }
      } catch (e) { /* use defaults */ }
      VoiceCore.buildExitPhrases();
      VoiceCore.updateAllBtnUI();
      VoiceSettings.updateSettingsPanel();
      VoiceCore.updateBrowserWarning();
    }

    // ── 5. 注入全局共享（参考 openclacky 的 window.Clacky 命名空间模式）──
    // 收敛到单一 window.VoiceInput 命名空间，避免 9 个 __voice* 散落全局
    window.VoiceInput = {
      cfg:            cfg,
      defs:           defs,
      ext:            EXT,
      t:              t,
      currentLang:    currentLang,
      deepMergeInto:  deepMergeInto,
      formatShortcut: formatShortcut,
      saveConfig:     saveConfig,
    };

    // ── 6. 初始化 — 加载配置，启动两模块 ──
    (async function() {
      await loadConfig();
      VoiceCore.init();
    })();

    // ── 7. 挂载：session.composer（输入框上方快捷按钮）──
    Clacky.ext.ui.mount("session.composer", function () {
      return VoiceCore.createComposerUI();
    });

    // ── 8. 挂载：Settings 页 ──
    // 修复 settings 槽位渲染：
    // 1) settings.tabs/body 是 SESSION_SCOPED_SLOTS，受 agent scope 过滤
    // 2) view.js 加载时 _extBegin 已设置 _currentPanel，同步 mount 会被标为 panel-scoped
    // 3) 主页 agentProfile 为 null，panel-scoped renderer 被 _visibleFor 全部过滤
    // 4) setTimeout 让 mount 在 _extEnd() 清掉 _currentPanel 后注册 → 全局 mount (panel:null)
    // 5) 注册完成后再 renderSlot 触发渲染
    setTimeout(function () {
      Clacky.ext.ui.mount("settings.tabs", function () {
        var tab = document.createElement("button");
        tab.className = "settings-tab";
        tab.dataset.tab = "voice-input";
        tab.textContent = t("panel.title");
        return tab;
      });

      Clacky.ext.ui.mount("settings.body", function () {
        var content = document.createElement("div");
        content.className = "settings-tab-content vi-settings-panel";
        content.dataset.tabContent = "voice-input";
        content.style.display = "none";
        VoiceSettings.buildSettingsPanel(content);
        VoiceSettings.setPanel(content);
        VoiceSettings.updateSettingsPanel();
        var observer = new MutationObserver(function (mutations) {
          for (var i = 0; i < mutations.length; i++) {
            if (mutations[i].target === content && content.style.display !== "none") {
              VoiceSettings.setPanel(content);
              VoiceSettings.updateSettingsPanel();
            }
          }
        });
        observer.observe(content, { attributes: true, attributeFilter: ["style"] });
        return content;
      });

      var tabsSlot = document.querySelector('[data-slot="settings.tabs"]');
      var bodySlot = document.querySelector('[data-slot="settings.body"]');
      if (tabsSlot) Clacky.ext.renderSlot("settings.tabs", tabsSlot);
      if (bodySlot) Clacky.ext.renderSlot("settings.body", bodySlot);
    }, 0);
  }

  // ── 启动：加载子模块后执行 initApp ──
  loadSubModules(initApp);
})();
