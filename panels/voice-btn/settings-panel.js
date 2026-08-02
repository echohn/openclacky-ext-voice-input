// voice-input 扩展 — 设置面板模块
// 挂载到 window.VoiceSettings
(function () {
  "use strict";
  if (!window.Clacky || !Clacky.ext) return;
  // ═══════════════════════════════════════════════════════════════════
  // 0. 共享引用（由 view.js 注入）
  // ═══════════════════════════════════════════════════════════════════
  // window.VoiceInput.cfg — 全局配置对象
  // window.VoiceInput.t — i18n t() 函数
  // window.VoiceInput.formatShortcut — 快捷键格式化
  // window.VoiceInput.deepMergeInto — 深度合并
  // window.VoiceInput.saveConfig — 持久化保存
  // window.VoiceInput.defs — 默认配置
  // ═══════════════════════════════════════════════════════════════════
  // 1. 内部状态
  // ═══════════════════════════════════════════════════════════════════
  var settingsPanel = null;
  // 音量滑块渐变更新（统一入口，避免 CSS 变量不一致导致回归）
  function updateVolumeGradient(input) {
    var pct = ((input.value - input.min) / (input.max - input.min)) * 100;
    input.style.background =
      "linear-gradient(to right, var(--color-accent-primary,#4f46e5) " +
      pct +
      "%, var(--color-border-primary,#d4d4ce) " +
      pct +
      "%)";
  }
  // 音效文件存在性检查（异步）
  function checkSoundFile(filename, inputEl) {
    if (!filename || filename === "none" || filename === "default") {
      // 内置/无音效，清除警告
      clearSoundWarning(inputEl);
      return;
    }
    var url =
      "/api/ext/" +
      window.VoiceInput.ext +
      "/sounds/" +
      encodeURIComponent(filename);
    fetch(url, { method: "GET" })
      .then(function (res) {
        if (res.ok) {
          clearSoundWarning(inputEl);
        } else {
          showSoundWarning(inputEl, filename);
        }
      })
      .catch(function () {
        showSoundWarning(inputEl, filename);
      });
  }
  function showSoundWarning(inputEl, filename) {
    if (!inputEl) return;
    inputEl.classList.add("sound-missing");
    // 移除旧警告
    var oldWarn = inputEl.parentNode.querySelector(".vi-sound-warn");
    if (oldWarn) oldWarn.remove();
    var t = window.VoiceInput.t;
    var warn = document.createElement("span");
    warn.className = "vi-sound-warn";
    warn.textContent = t("settings.sound.file_not_found", { file: filename });
    inputEl.parentNode.appendChild(warn);
  }
  function clearSoundWarning(inputEl) {
    if (!inputEl) return;
    inputEl.classList.remove("sound-missing");
    var oldWarn = inputEl.parentNode.querySelector(".vi-sound-warn");
    if (oldWarn) oldWarn.remove();
  }
  // ═══════════════════════════════════════════════════════════════════
  // 2. onSettingsChange — 设置变更处理
  // ═══════════════════════════════════════════════════════════════════
  async function onSettingsChange(key, value) {
    var partial = {};
    var parts = key.split(".");
    var obj = partial;
    for (var i = 0; i < parts.length - 1; i++) {
      obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = value;
    window.VoiceInput.deepMergeInto(window.VoiceInput.cfg, partial);
    window.VoiceCore.buildExitPhrases();
    // 默认模式变更时同步 voiceMode 内部状态
    if (key === "default_mode") {
      window.VoiceCore.syncVoiceModeFromConfig();
    }
    // 按钮垂直位置变更时即时生效
    if (key === "ui.composer_align") {
      window.VoiceCore.updateComposerAlignment();
    }
    // 先乐观更新 UI
    window.VoiceCore.updateAllBtnUI();
    window.VoiceCore.updateBrowserWarning();
    updateSettingsPanel();
    // 保存并检查后端返回的 warnings
    var response = await window.VoiceInput.saveConfig(partial);
    if (response && response.warnings && response.warnings.length > 0) {
      showWarnings(response.warnings);
    } else {
      dismissWarnings();
    }
  }
  // ═══════════════════════════════════════════════════════════════════
  // 3. CSS 注入（设置面板相关）
  // ═══════════════════════════════════════════════════════════════════
  if (!document.getElementById("voice-settings-style")) {
    var style = document.createElement("style");
    style.id = "voice-settings-style";
    style.textContent = [
      /* ── 间距修复：覆盖 OpenClacky 内置 .settings-tab-content { gap: 2rem } ── */
      ".vi-settings-panel { gap: 0; }",
      /* ── 警告横幅 ── */
      "#vi-warnings-banner{background:var(--color-warning-bg,#fff8e1);border:1px solid var(--color-warning-border,#ffe082);border-radius:6px;padding:8px 12px;margin-bottom:12px;position:relative;opacity:1;animation:viFadeIn 0.25s ease both}",
      "#vi-warnings-banner .vi-warn-close{position:absolute;top:4px;right:8px;background:none;border:none;font-size:18px;cursor:pointer;color:var(--color-warning,#f59e0b);line-height:1;padding:0 2px}",
      "#vi-warnings-banner .vi-warn-line{font-size:12px;color:var(--color-warning,#f59e0b);margin:3px 0;padding-right:20px;line-height:1.5}",
      "#vi-warnings-banner .vi-warn-field{background:var(--color-warning-border,#fde68a);padding:1px 5px;border-radius:3px;font-size:11px;margin-right:4px;font-family:monospace}",
      "@keyframes viFadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}",
      ".vi-warn-badge{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;border-radius:9px;background:var(--color-warning,#f0a020);color:#fff;font-size:10px;font-weight:700;margin-left:4px;padding:0 5px;line-height:1}",
      /* ── 快捷键录制指示器 ── */
      ".vi-recording{background:var(--color-accent-bg,#e8f0fe);border-color:var(--color-accent-primary,#4a9eff);text-align:center;color:var(--color-accent-primary,#4a9eff);font-weight:600}",
      /* ── 设置面板通用样式 ── */
      ".vi-section-title{font-size:12px;font-weight:600;color:var(--color-text-secondary,#666);margin:16px 0 8px;padding-bottom:3px;border-bottom:1px solid var(--color-border-primary,#d4d4ce)}",
      ".vi-section-title:first-child{margin-top:0}",
      ".vi-btn-group{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 4px}",
      ".vi-engine-option{padding:5px 12px;font-size:12px;border-radius:5px;cursor:pointer;border:1px solid var(--color-border-primary,#d4d4ce);background:var(--color-bg-primary,#fff);color:var(--color-text-secondary,#666);transition:all 120ms}",
      ".vi-engine-option:hover{background:var(--color-bg-hover,#f5f5f4);border-color:var(--color-border-strong,#b0b0a8)}",
      ".vi-engine-option.is-active{background:var(--color-accent-primary,#4a9eff);color:#fff;border-color:var(--color-accent-primary,#4a9eff)}",
      ".vi-row{display:flex;align-items:center;gap:8px;margin:6px 0}",
      ".vi-label{font-size:12px;color:var(--color-text-secondary,#666);min-width:70px;flex-shrink:0}",
      ".vi-input{flex:1;max-width:220px;font-size:12px}",
      ".vi-input select{width:100%}",
      ".vi-desc{font-size:11px;color:var(--color-text-muted,#999);margin:6px 0 8px;line-height:1.5}",
      ".vi-volume-value{font-size:11px;color:var(--color-text-muted,#999);min-width:28px;text-align:right}",
      /* ── Settings 页风格对齐（scope 在 .vi-settings-panel 内覆盖独立面板样式）── */
      ".vi-settings-panel .vi-section-title{font-size:14px;font-weight:600;color:var(--color-text-primary,#222);margin:20px 0 6px;padding-bottom:0;border-bottom:none}",
      ".vi-settings-panel .vi-section-title:first-child{margin-top:0}",
      ".vi-settings-panel .vi-row{margin:8px 0}",
      ".vi-settings-panel .vi-desc{font-size:12px;margin:4px 0 12px}",
      ".vi-settings-panel .vi-btn-group{margin:8px 0 4px}",
      ".vi-settings-panel .vi-engine-option{padding:4px 10px}",
      ".vi-settings-panel .vi-label{min-width:60px}",
      /* ── 音效文件不存在警告 ── */
      ".vi-input.sound-missing{border-color:var(--color-error,#e74c3c)!important;box-shadow:0 0 0 1px var(--color-error,#e74c3c)}",
      ".vi-sound-warn{display:block;font-size:11px;color:var(--color-error,#e74c3c);margin-top:2px;line-height:1.4}",
    ].join("\n");
    document.head.appendChild(style);
  }
  // ═══════════════════════════════════════════════════════════════════
  // 4. 构建设置面板 UI
  // ═══════════════════════════════════════════════════════════════════
  function buildSettingsPanel(wrapper) {
    var t = window.VoiceInput.t;
    var formatShortcut = window.VoiceInput.formatShortcut;
    var cfg = window.VoiceInput.cfg;
    var defs = window.VoiceInput.defs;
    wrapper.innerHTML = "";
    // ── 辅助 builder ──
    function sec(title) {
      var s = document.createElement("div");
      s.className = "vi-section-title";
      s.textContent = title;
      return s;
    }
    function btnGroup() {
      var g = document.createElement("div");
      g.className = "vi-btn-group";
      return g;
    }
    function segBtn(cls, id, label, value, group, onChange) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = cls;
      b.id = id;
      b.textContent = label;
      b.dataset.value = value;
      b.addEventListener("click", function () {
        onChange(value);
      });
      group.appendChild(b);
      return b;
    }
    function fieldRow(id, label, placeholder, inputType) {
      var row = document.createElement("div");
      row.className = "vi-row";
      var lbl = document.createElement("label");
      lbl.className = "vi-label";
      lbl.textContent = label;
      var inp = document.createElement("input");
      inp.type = inputType || "text";
      inp.className = "form-input vi-input";
      if (placeholder) inp.placeholder = placeholder;
      if (inputType === "range") inp.value = placeholder;
      if (id) inp.id = id;
      row.appendChild(lbl);
      row.appendChild(inp);
      return { row: row, input: inp };
    }
    function selectRow(id, label, options, currentValue) {
      var row = document.createElement("div");
      row.className = "vi-row";
      var lbl = document.createElement("label");
      lbl.className = "vi-label";
      lbl.textContent = label;
      var wrap = document.createElement("div");
      wrap.className = "new-session-field vi-input";
      var sel = document.createElement("select");
      sel.className = "new-session-select";
      if (id) sel.id = id;
      options.forEach(function (opt) {
        var o = document.createElement("option");
        o.value = opt.value;
        o.textContent = opt.label;
        if (opt.value === currentValue) o.selected = true;
        sel.appendChild(o);
      });
      wrap.appendChild(sel);
      row.appendChild(lbl);
      row.appendChild(wrap);
      return { row: row, select: sel };
    }
    function desc(html) {
      var d = document.createElement("div");
      d.className = "vi-desc";
      d.innerHTML = html;
      return d;
    }
    // ── 识别引擎 ──
    wrapper.appendChild(sec(t("settings.engine")));
    var engGroup = btnGroup();
    segBtn(
      "vi-engine-option",
      "vi-engine-browser",
      t("settings.engine.browser"),
      "google",
      engGroup,
      function (v) {
        onSettingsChange("asr.provider", v);
      },
    );
    segBtn(
      "vi-engine-option",
      "vi-engine-dashscope",
      t("settings.engine.dashscope"),
      "dashscope",
      engGroup,
      function (v) {
        onSettingsChange("asr.provider", v);
      },
    );
    wrapper.appendChild(engGroup);
    wrapper.appendChild(desc(t("settings.engine.desc")));
    var apiRow = fieldRow(
      "vi-apikey",
      t("settings.apikey"),
      "sk-...",
      "password",
    );
    apiRow.row.style.display = "none";
    apiRow.input.addEventListener("change", function () {
      onSettingsChange("asr.api_key", apiRow.input.value);
    });
    wrapper.appendChild(apiRow.row);
    // ── 识别语言 ──
    wrapper.appendChild(sec(t("settings.language")));
    var langGrp = btnGroup();
    segBtn(
      "vi-lang-option vi-engine-option",
      null,
      t("settings.lang.zh"),
      "zh-CN",
      langGrp,
      function (v) {
        onSettingsChange("language", v);
      },
    );
    segBtn(
      "vi-lang-option vi-engine-option",
      null,
      t("settings.lang.en"),
      "en-US",
      langGrp,
      function (v) {
        onSettingsChange("language", v);
      },
    );
    wrapper.appendChild(langGrp);
    // ── 按钮位置 ──
    wrapper.appendChild(sec(t("settings.position")));
    var alignOptions = [
      { value: "top", label: t("settings.position.top") },
      { value: "center", label: t("settings.position.center") },
      { value: "bottom", label: t("settings.position.bottom") },
    ];
    var alignRow = selectRow(
      "vi-composer-align",
      t("settings.position.label"),
      alignOptions,
      (cfg.ui && cfg.ui.composer_align) || "bottom",
    );
    alignRow.select.addEventListener("change", function () {
      onSettingsChange("ui.composer_align", alignRow.select.value);
    });
    wrapper.appendChild(alignRow.row);
    wrapper.appendChild(desc(t("settings.position.desc")));
    // ── 加载顺序 ──
    var orderRow = fieldRow(
      "vi-composer-order",
      t("settings.order"),
      "5",
      "number",
    );
    orderRow.input.className = "form-input vi-input";
    orderRow.input.style.width = "80px";
    orderRow.input.min = "-100";
    orderRow.input.max = "100";
    orderRow.input.value = (cfg.ui && cfg.ui.composer_order) || 5;
    orderRow.input.addEventListener("change", function () {
      var v = parseInt(orderRow.input.value, 10);
      if (isNaN(v)) v = 5;
      onSettingsChange("ui.composer_order", v);
    });
    wrapper.appendChild(orderRow.row);
    wrapper.appendChild(desc(t("settings.order.desc")));
    // ── 默认模式 ──
    wrapper.appendChild(sec(t("settings.mode")));
    var modeGrp = btnGroup();
    segBtn(
      "vi-mode-option vi-engine-option",
      null,
      t("settings.mode.push"),
      "push-to-talk",
      modeGrp,
      function (v) {
        onSettingsChange("default_mode", v);
      },
    );
    segBtn(
      "vi-mode-option vi-engine-option",
      null,
      t("settings.mode.handsfree"),
      "hands-free",
      modeGrp,
      function (v) {
        onSettingsChange("default_mode", v);
      },
    );
    wrapper.appendChild(modeGrp);
    wrapper.appendChild(desc(t("settings.mode.desc")));
    // ── 快捷键（录制模式）──
    wrapper.appendChild(sec(t("settings.shortcuts")));
    var shortcutLabels = {
      toggle: t("settings.shortcuts.toggle"),
      stop: t("settings.shortcuts.stop"),
      start: t("settings.shortcuts.start"),
      voice_mode: t("settings.shortcuts.voice_mode"),
    };
    ["toggle", "stop", "start", "voice_mode"].forEach(function (a) {
      var r = fieldRow(
        "vi-shortcut-" + a,
        shortcutLabels[a] || a,
        t("settings.shortcuts"),
      );
      r.input.readOnly = true;
      r.input.style.cursor = "pointer";
      r.input.style.width = "140px";
      r.input.value =
        cfg.shortcuts && cfg.shortcuts[a]
          ? formatShortcut(cfg.shortcuts[a])
          : "";
      r.input.addEventListener("focus", function () {
        r.input.value = "...";
        r.input.classList.add("vi-recording");
      });
      r.input.addEventListener("blur", function () {
        r.input.value =
          cfg.shortcuts && cfg.shortcuts[a]
            ? formatShortcut(cfg.shortcuts[a])
            : "";
        r.input.classList.remove("vi-recording");
      });
      r.input.addEventListener("keydown", function (e) {
        e.preventDefault();
        e.stopPropagation();
        // 忽略仅修饰键 / Tab / Esc
        if (
          [
            "Control",
            "Shift",
            "Alt",
            "Meta",
            "Tab",
            "Escape",
            "CapsLock",
          ].indexOf(e.key) >= 0
        )
          return;
        var mods = [];
        if (e.ctrlKey) mods.push("Control");
        if (e.shiftKey) mods.push("Shift");
        if (e.altKey) mods.push("Alt");
        if (e.metaKey) mods.push("Meta");
        var sc = { modifiers: mods, key: e.key.toLowerCase() };
        var display = formatShortcut(sc);
        r.input.value = display;
        var allSc = JSON.parse(JSON.stringify(cfg.shortcuts || defs.shortcuts));
        allSc[a] = sc;
        onSettingsChange("shortcuts", allSc);
        r.input.blur();
      });
      wrapper.appendChild(r.row);
    });
    wrapper.appendChild(desc(t("settings.shortcuts.desc")));
    // ── 退出词 ──
    wrapper.appendChild(sec(t("settings.exit_words")));
    var ewRow = document.createElement("div");
    ewRow.className = "vi-row";
    var ewLbl = document.createElement("label");
    ewLbl.className = "vi-label";
    ewLbl.textContent = t("settings.exit_words.label");
    var ewArea = document.createElement("textarea");
    ewArea.id = "vi-exit-words";
    ewArea.className = "form-textarea vi-input";
    ewArea.rows = 3;
    ewArea.placeholder = t("settings.exit_words.placeholder");
    ewArea.addEventListener("change", function () {
      var lines = ewArea.value
        .split("\n")
        .map(function (l) {
          return l.trim();
        })
        .filter(Boolean);
      onSettingsChange("exit_words", lines);
    });
    ewRow.appendChild(ewLbl);
    ewRow.appendChild(ewArea);
    wrapper.appendChild(ewRow);
    wrapper.appendChild(desc(t("settings.exit_words.desc")));
    // ── 音效 ──
    wrapper.appendChild(sec(t("settings.sound")));
    var soundStart = fieldRow(
      "vi-sound-start",
      t("settings.sound.start"),
      "default / none / voice-start.mp3",
    );
    soundStart.input.style.maxWidth = "200px";
    soundStart.input.addEventListener("change", function () {
      var val = soundStart.input.value.trim();
      onSettingsChange("sound.start", val);
      checkSoundFile(val, soundStart.input);
    });
    wrapper.appendChild(soundStart.row);
    var soundStop = fieldRow(
      "vi-sound-stop",
      t("settings.sound.stop"),
      "default / none / ding.wav",
    );
    soundStop.input.style.maxWidth = "200px";
    soundStop.input.addEventListener("change", function () {
      var val = soundStop.input.value.trim();
      onSettingsChange("sound.stop", val);
      checkSoundFile(val, soundStop.input);
    });
    wrapper.appendChild(soundStop.row);
    var volRow = fieldRow(
      "vi-sound-volume",
      t("settings.sound.volume"),
      "0.4",
      "range",
    );
    volRow.input.min = "0";
    volRow.input.max = "1";
    volRow.input.step = "0.05";
    volRow.input.style.width = "120px";
    var volVal = document.createElement("span");
    volVal.className = "vi-volume-value";
    volVal.textContent = volRow.input.value;
    var volDebounce = null;
    volRow.input.addEventListener("input", function () {
      volVal.textContent = volRow.input.value;
      updateVolumeGradient(volRow.input);
      if (volDebounce) clearTimeout(volDebounce);
      var v = parseFloat(volRow.input.value);
      volDebounce = setTimeout(function () {
        onSettingsChange("sound.volume", v);
      }, 300);
    });
    volRow.row.appendChild(volVal);
    wrapper.appendChild(volRow.row);
    wrapper.appendChild(desc(t("settings.sound.desc")));
    // ── 时间参数 ──
    wrapper.appendChild(sec(t("settings.timing")));
    var silenceRow = fieldRow(
      "vi-silence",
      t("settings.timing.silence"),
      "1500",
      "number",
    );
    silenceRow.input.style.width = "80px";
    silenceRow.input.addEventListener("change", function () {
      onSettingsChange(
        "silence_timeout_ms",
        parseInt(silenceRow.input.value) || 1500,
      );
    });
    wrapper.appendChild(silenceRow.row);
    var restartRow = fieldRow(
      "vi-restart-delay",
      t("settings.timing.restart"),
      "300",
      "number",
    );
    restartRow.input.style.width = "80px";
    restartRow.input.addEventListener("change", function () {
      onSettingsChange(
        "voice_mode_restart_delay_ms",
        parseInt(restartRow.input.value) || 300,
      );
    });
    wrapper.appendChild(restartRow.row);
    wrapper.appendChild(desc(t("settings.timing.desc")));
  }
  // ═══════════════════════════════════════════════════════════════════
  // 5. 刷新设置面板控件值
  // ═══════════════════════════════════════════════════════════════════
  function updateSettingsPanel() {
    if (!settingsPanel) return;
    var cfg = window.VoiceInput.cfg;
    var formatShortcut = window.VoiceInput.formatShortcut;
    var t = window.VoiceInput.t;
    var qs = function (sel) {
      return settingsPanel.querySelector(sel);
    };
    // Engine
    var engBtns = settingsPanel.querySelectorAll(".vi-engine-option");
    var currentProv = (cfg.asr && cfg.asr.provider) || "google";
    for (var i = 0; i < engBtns.length; i++) {
      engBtns[i].classList.toggle(
        "is-active",
        engBtns[i].dataset.value === currentProv,
      );
    }
    var apiInput = qs("#vi-apikey");
    var apiRow = apiInput ? apiInput.closest(".vi-row") : null;
    if (apiRow)
      apiRow.style.display = currentProv === "dashscope" ? "" : "none";
    if (apiInput) apiInput.value = (cfg.asr && cfg.asr.api_key_masked) || "";
    // Language
    var langBtns = settingsPanel.querySelectorAll(".vi-lang-option");
    for (var j = 0; j < langBtns.length; j++) {
      langBtns[j].classList.toggle(
        "is-active",
        langBtns[j].dataset.value === (cfg.language || "zh-CN"),
      );
    }
    // Mode
    var modeBtns = settingsPanel.querySelectorAll(".vi-mode-option");
    for (var k = 0; k < modeBtns.length; k++) {
      modeBtns[k].classList.toggle(
        "is-active",
        modeBtns[k].dataset.value === (cfg.default_mode || "push-to-talk"),
      );
    }
    // Shortcuts
    ["toggle", "stop", "start", "voice_mode"].forEach(function (a) {
      var inp = qs("#vi-shortcut-" + a);
      if (inp && cfg.shortcuts && cfg.shortcuts[a])
        inp.value =
          formatShortcut(cfg.shortcuts[a]) || cfg.shortcuts[a].key || "";
    });
    // Exit words
    var ew = qs("#vi-exit-words");
    if (ew) {
      var words = cfg.exit_words || [];
      if (typeof words === "string") words = words.split(/[,，]/);
      ew.value = words.join("\n");
    }
    // Sound files
    var startSound = qs("#vi-sound-start");
    var stopSound = qs("#vi-sound-stop");
    var soundVol = qs("#vi-sound-volume");
    if (startSound) {
      startSound.value = (cfg.sound && cfg.sound.start) || "";
      checkSoundFile(startSound.value, startSound);
    }
    if (stopSound) {
      stopSound.value = (cfg.sound && cfg.sound.stop) || "";
      checkSoundFile(stopSound.value, stopSound);
    }
    if (soundVol) {
      soundVol.value =
        cfg.sound && cfg.sound.volume != null ? cfg.sound.volume : 0.4;
      updateVolumeGradient(soundVol);
      var volVal = soundVol.parentNode.querySelector(".vi-volume-value");
      if (volVal) volVal.textContent = soundVol.value;
    }
    // Delays
    var silenceInp = qs("#vi-silence");
    var restartInp = qs("#vi-restart-delay");
    if (silenceInp) silenceInp.value = cfg.silence_timeout_ms || 1500;
    if (restartInp) restartInp.value = cfg.voice_mode_restart_delay_ms || 300;
    // UI 位置 / 顺序
    var alignSel = qs("#vi-composer-align");
    var orderInp = qs("#vi-composer-order");
    if (alignSel) alignSel.value = (cfg.ui && cfg.ui.composer_align) || "bottom";
    if (orderInp) orderInp.value = (cfg.ui && cfg.ui.composer_order != null ? cfg.ui.composer_order : 5);
  }
  // ═══════════════════════════════════════════════════════════════════
  // 5.5 警告横幅
  // ═══════════════════════════════════════════════════════════════════
  function showWarnings(warnings) {
    if (!settingsPanel) return;
    dismissWarnings();
    var t = window.VoiceInput.t;
    var banner = document.createElement("div");
    banner.id = "vi-warnings-banner";
    // 关闭按钮
    var closeBtn = document.createElement("button");
    closeBtn.className = "vi-warn-close";
    closeBtn.textContent = "\u00d7";
    closeBtn.addEventListener("click", dismissWarnings);
    banner.appendChild(closeBtn);
    // 逐条警告
    for (var i = 0; i < warnings.length; i++) {
      var w = warnings[i];
      var line = document.createElement("div");
      line.className = "vi-warn-line";
      if (w.field) {
        var fieldTag = document.createElement("code");
        fieldTag.className = "vi-warn-field";
        fieldTag.textContent = w.field;
        line.appendChild(fieldTag);
      }
      line.appendChild(document.createTextNode(w.message || ""));
      banner.appendChild(line);
    }
    settingsPanel.insertBefore(banner, settingsPanel.firstChild);
    // 自动激活设置 tab（修复：父容器 display:none 导致不可见）
    var tabBtn = document.querySelector(
      '.settings-tab[data-tab="voice-input"]',
    );
    if (tabBtn) {
      // 添加/更新警告计数徽章
      updateWarningBadge(warnings.length);
      // 如果设置面板当前被隐藏，激活它
      if (settingsPanel.style.display === "none") {
        tabBtn.click();
      }
    }
  }
  function dismissWarnings() {
    var banner = document.getElementById("vi-warnings-banner");
    if (banner) banner.remove();
    // 清除徽章
    updateWarningBadge(0);
  }
  // 更新 tab 上的警告徽章（count=0 时移除）
  function updateWarningBadge(count) {
    var tabBtn = document.querySelector(
      '.settings-tab[data-tab="voice-input"]',
    );
    if (!tabBtn) return;
    var badge = tabBtn.querySelector(".vi-warn-badge");
    if (count > 0) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "vi-warn-badge";
        tabBtn.appendChild(badge);
      }
      badge.textContent = count;
      badge.style.display = "";
    } else if (badge) {
      badge.style.display = "none";
    }
  }
  // ═══════════════════════════════════════════════════════════════════
  // 6. 导出到全局
  // ═══════════════════════════════════════════════════════════════════
  window.VoiceSettings = {
    onSettingsChange: onSettingsChange,
    buildSettingsPanel: buildSettingsPanel,
    updateSettingsPanel: updateSettingsPanel,
    setPanel: function (panel) {
      settingsPanel = panel;
    },
    showWarnings: showWarnings,
    dismissWarnings: dismissWarnings,
  };
})();
