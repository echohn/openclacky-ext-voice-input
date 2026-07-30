// voice-input 扩展 - 表现层模块（第5个加载，最后）
// 职责：CSS样式注入、Composer UI创建、按钮状态更新、录音计时器
(function () {
  "use strict";
  if (!window.VoiceCore || !VoiceCore._s) return;

  var s = VoiceCore._s;
  var f = VoiceCore._f;

  // ═══════════════════════════════════════════════════════════════════
  // CSS 注入（语音相关样式）
  // ═══════════════════════════════════════════════════════════════════
  if (!document.getElementById("voice-core-style")) {
    var style = document.createElement("style");
    style.id = "voice-core-style";
    style.textContent = [
      ".voice-composer{display:flex;align-items:center;gap:8px;padding:6px 8px;flex-wrap:wrap}",
      ".voice-mic-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;font-size:12px;font-weight:500;border-radius:13px;cursor:pointer;border:1px solid var(--color-border-primary,#d4d4ce);background:var(--color-bg-primary,#fff);color:var(--color-text-secondary,#666);box-shadow:var(--shadow-card,0 1px 2px rgba(0,0,0,.06));transition:all .15s ease;letter-spacing:.01em;user-select:none}",
      ".voice-mic-btn:hover:not(:disabled){background:var(--color-bg-hover,#f5f5f4);border-color:var(--color-border-strong,#b0b0a8);color:var(--color-text-primary,#222);box-shadow:0 2px 6px rgba(0,0,0,.1)}",
      ".voice-mic-btn:active:not(:disabled){transform:scale(.97);box-shadow:0 1px 2px rgba(0,0,0,.06)}",
      ".voice-mic-btn:disabled{opacity:.4;cursor:not-allowed;box-shadow:none}",
      ".voice-mic-btn.recording{background:linear-gradient(135deg,var(--color-error,#e74c3c),#c0392b);color:#fff;border-color:transparent;box-shadow:0 0 0 3px rgba(231,76,60,.25),0 2px 6px rgba(0,0,0,.15);animation:viMicPulse 1.5s ease-in-out infinite}",
      ".voice-mic-btn.recording:hover:not(:disabled){background:linear-gradient(135deg,#e74c3c,#c0392b);box-shadow:0 0 0 4px rgba(231,76,60,.3),0 2px 8px rgba(0,0,0,.2)}",
      ".voice-mic-btn.voice-mode{background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;border-color:transparent;box-shadow:0 0 0 3px rgba(99,102,241,.25),0 2px 6px rgba(0,0,0,.15);animation:viBreath 3s ease-in-out infinite}",
      ".voice-mic-btn.voice-mode:hover:not(:disabled){background:linear-gradient(135deg,#6366f1,#8b5cf6);box-shadow:0 0 0 4px rgba(99,102,241,.3),0 2px 8px rgba(0,0,0,.2)}",
      ".voice-mic-btn.voice-disabled{border:1px dashed #d4d4d4;background:#f5f5f5;color:#999;box-shadow:none}",
      "@keyframes viMicPulse{0%,100%{box-shadow:0 0 0 3px rgba(231,76,60,.25),0 2px 6px rgba(0,0,0,.15)}50%{box-shadow:0 0 0 8px rgba(231,76,60,0),0 2px 6px rgba(0,0,0,.15)}}",
      "@keyframes viBreath{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}",
      ".voice-status-text{font-size:11px;color:var(--color-text-muted);min-width:80px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      "@keyframes voice-dot-pulse{0%,100%{opacity:1}50%{opacity:.2}}",
      ".voice-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#fff;animation:voice-dot-pulse 1s infinite}",
      ".voice-mic-icon{width:16px;height:16px;flex-shrink:0}",
      ".voice-browser-warning{padding:10px 12px;margin-bottom:4px;font-size:12px;line-height:1.5;color:var(--color-warning-text,#8a6d14);background:var(--color-warning-bg,#fff8e1);border:1px solid var(--color-warning,#e6a817);border-radius:var(--radius-sm,6px)}",
      ".voice-browser-warning-inline{font-size:11px;color:var(--color-warning-text,#8a6d14);white-space:nowrap}",
      ".voice-warning-link{color:var(--color-accent-primary,#4a9eff);cursor:pointer;text-decoration:underline}",
      ".voice-error-toast-global{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;padding:12px 20px;font-size:13px;line-height:1.5;border-radius:8px;color:#fff;background:var(--color-error,#e74c3c);box-shadow:0 4px 16px rgba(0,0,0,.25);opacity:0;pointer-events:none;transition:opacity .25s ease}",
      ".voice-error-toast-global.active{opacity:1;pointer-events:auto}",
    ].join("\n");
    document.head.appendChild(style);
  }

  // ═══════════════════════════════════════════════════════════════════
  // 快捷键匹配
  // ═══════════════════════════════════════════════════════════════════
  f.matchShortcut = function (e) {
    var cfg = window.VoiceInput.cfg;
    var sc = cfg.shortcuts || {};
    var MOD = { Control: "ctrlKey", Shift: "shiftKey", Alt: "altKey", Meta: "metaKey" };
    var k = (e.key || "").toLowerCase();
    var all = ["Control", "Shift", "Alt", "Meta"];
    for (var action in sc) {
      var scDef = sc[action];
      if (!scDef || !scDef.key || k !== String(scDef.key).toLowerCase()) continue;
      var req = scDef.modifiers || [];
      var ok = true;
      for (var i = 0; i < all.length; i++) {
        if (!!e[MOD[all[i]]] !== req.indexOf(all[i]) >= 0) {
          ok = false;
          break;
        }
      }
      if (ok) return action;
    }
    return null;
  };

  // ═══════════════════════════════════════════════════════════════════
  // 录音计时器
  // ═══════════════════════════════════════════════════════════════════
  f.formatTimer = function () {
    if (!s.recordingStartTime) return "";
    var elapsed = Math.floor((Date.now() - s.recordingStartTime) / 1000);
    var mins = Math.floor(elapsed / 60);
    var secs = elapsed % 60;
    return (mins < 10 ? "0" : "") + mins + ":" + (secs < 10 ? "0" : "") + secs;
  };

  f.startTimer = function () {
    s.recordingStartTime = Date.now();
    if (s.recordingTimerId) clearInterval(s.recordingTimerId);
    s.recordingTimerId = setInterval(function () {
      if (s.composerStatus && s.listening) {
        var t = window.VoiceInput.t;
        var timerStr = f.formatTimer();
        var statusText = s.voiceMode ? t("composer.voice_mode") : t("composer.recording");
        s.composerStatus.textContent = statusText + (timerStr ? " " + timerStr : "");
      }
    }, 1000);
  };

  f.stopTimer = function () {
    s.recordingStartTime = null;
    if (s.recordingTimerId) {
      clearInterval(s.recordingTimerId);
      s.recordingTimerId = null;
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // 浏览器警告 UI
  // ═══════════════════════════════════════════════════════════════════
  f.updateBrowserWarning = function () {
    var t = window.VoiceInput.t;
    var cfg = window.VoiceInput.cfg;
    var ok = f.checkBrowserSupport();
    var engName = cfg.asr && cfg.asr.provider === "dashscope" ? "DashScope" : "浏览器原生";
    if (ok) {
      if (s.browserWarningBtn) s.browserWarningBtn.style.display = "none";
      if (s.composerBtn) {
        s.composerBtn.disabled = false;
        s.composerBtn.title = "";
      }
    } else {
      if (s.browserWarningBtn) s.browserWarningBtn.style.display = "";
      if (s.composerBtn) {
        s.composerBtn.disabled = true;
        s.composerBtn.title = t("composer.title_unsupported");
      }
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // UI 状态更新
  // ═══════════════════════════════════════════════════════════════════
  f.updateAllBtnUI = function () {
    var t = window.VoiceInput.t;
    var ok = f.checkBrowserSupport();
    if (s.composerBtn) {
      s.composerBtn.classList.toggle("recording", s.listening && !s.voiceMode);
      s.composerBtn.classList.toggle("voice-mode", s.listening && s.voiceMode);
      s.composerBtn.style.color = "";
      if (s.listening && s.voiceMode) {
        s.composerBtn.innerHTML =
          '<svg class="voice-mic-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> ' +
          t("composer.voice_mode_btn");
      } else if (s.listening && !s.voiceMode) {
        s.composerBtn.innerHTML =
          '<svg class="voice-mic-icon" viewBox="0 0 24 24" fill="#fff"><rect x="4" y="4" width="16" height="16" rx="2"/></svg> ' +
          t("composer.click_stop");
      } else {
        s.composerBtn.innerHTML =
          '<svg class="voice-mic-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg> ' +
          t("composer.mic_label");
      }
      if (!ok && !s.listening) {
        s.composerBtn.classList.add("voice-disabled");
        s.composerBtn.innerHTML =
          '<svg class="voice-mic-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/><line x1="1" y1="1" x2="23" y2="23"/></svg> ' +
          t("composer.unsupported_short");
        s.composerBtn.title = t("composer.title_unsupported");
      } else {
        s.composerBtn.classList.remove("voice-disabled");
        s.composerBtn.title = "";
      }
    }
    if (s.composerStatus) {
      if (s.listening) {
        s.composerStatus.style.color = "";
        var timerStr = f.formatTimer();
        var statusText = s.voiceMode ? t("composer.voice_mode") : t("composer.recording");
        s.composerStatus.textContent = statusText + (timerStr ? " " + timerStr : "");
      } else {
        s.composerStatus.textContent = "";
        s.composerStatus.style.color = "";
      }
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // 退出词构建
  // ═══════════════════════════════════════════════════════════════════
  f.buildExitPhrases = function () {
    var cfg = window.VoiceInput.cfg;
    s.exitPhrases = [];
    var words = cfg.exit_words || [];
    if (typeof words === "string") words = words.split(/[,，]/);
    for (var i = 0; i < words.length; i++) {
      var w = String(words[i]).trim().toLowerCase();
      if (w) s.exitPhrases.push(w);
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // 创建 Composer UI（供 view.js mount 调用）
  // ═══════════════════════════════════════════════════════════════════
  f.createComposerUI = function () {
    var t = window.VoiceInput.t;
    var wrap = document.createElement("div");
    wrap.className = "voice-composer";
    // 浏览器不支持警告（composer 内联）
    s.browserWarningBtn = document.createElement("span");
    s.browserWarningBtn.className = "voice-browser-warning-inline";
    s.browserWarningBtn.textContent = t("composer.browser_warning_link");
    s.browserWarningBtn.style.display = "none";
    s.browserWarningBtn.style.cursor = "pointer";
    s.browserWarningBtn.addEventListener("click", function () {
      if (window.VoiceSettings && window.VoiceSettings.onSettingsChange) {
        window.VoiceSettings.onSettingsChange("asr.provider", "dashscope");
      }
      f.updateBrowserWarning();
      if (window.VoiceSettings && window.VoiceSettings.updateSettingsPanel) {
        window.VoiceSettings.updateSettingsPanel();
      }
    });
    s.composerBtn = document.createElement("button");
    s.composerBtn.type = "button";
    s.composerBtn.className = "voice-mic-btn";
    s.composerBtn.innerHTML =
      '<svg class="voice-mic-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg> ' +
      t("composer.mic_label");
    s.composerBtn.addEventListener("click", f.toggleRecording);
    s.composerStatus = document.createElement("span");
    s.composerStatus.className = "voice-status-text";
    wrap.appendChild(s.browserWarningBtn);
    wrap.appendChild(s.composerBtn);
    wrap.appendChild(s.composerStatus);
    // 浮动 toast（ASR 错误提示，全局 fixed）
    // P0-3: 先清理旧 toast，防止切会话累积僵尸 DOM
    var oldToast = document.querySelector(".voice-error-toast-global");
    if (oldToast) oldToast.remove();
    s.errorToast = document.createElement("div");
    s.errorToast.className = "voice-error-toast-global";
    document.body.appendChild(s.errorToast);
    // 切换会话时 session.composer 会重新渲染，新按钮需要同步当前状态
    f.updateAllBtnUI();
    f.updateBrowserWarning();
    return wrap;
  };
})();
