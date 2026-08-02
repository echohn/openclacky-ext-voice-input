// voice-input 扩展 - 语音核心主模块（第1个加载）
// 职责：创建命名空间、共享状态对象、录音控制、初始化、公共API导出
// 子模块加载顺序：voice-core → voice-state → voice-audio → voice-engines → voice-ui
(function () {
  "use strict";
  if (!window.Clacky || !window.Clacky.ext) return;

  // ═══════════════════════════════════════════════════════════════════
  // 创建命名空间 + 共享状态对象 + 函数注册表
  // ═══════════════════════════════════════════════════════════════════
  window.VoiceCore = {
    _s: {
      // ── 设备级状态（跨会话共享）──
      listening: false,
      voiceMode: false,
      engine: null,
      gen: 0,
      retryCount: 0,
      silenceTimer: null,
      exitPhrases: [],
      // ── 会话级状态 ──
      sessionBuffers: {},
      activeSessionId: null,
      asrState: null,
      lastDisplay: "",
      editState: "clean",
      // ── UI 引用 ──
      composerBtn: null,
      composerStatus: null,
      errorToast: null,
      browserWarningBtn: null,
      toastTimer: null,
      // ── 计时器 ──
      recordingStartTime: null,
      recordingTimerId: null,
    },
    _f: {},
  };

  var s = VoiceCore._s;
  var f = VoiceCore._f;

  // 模块局部变量
  var browserSpeechSupported = !!(
    window.SpeechRecognition || window.webkitSpeechRecognition
  );

  // ═══════════════════════════════════════════════════════════════════
  // 浏览器支持检测
  // ═══════════════════════════════════════════════════════════════════
  f.checkBrowserSupport = function () {
    var cfg = window.VoiceInput.cfg;
    if ((cfg.asr && cfg.asr.provider) === "dashscope") return true;
    return browserSpeechSupported;
  };

  // ═══════════════════════════════════════════════════════════════════
  // 录音控制
  // ═══════════════════════════════════════════════════════════════════
  f.startRecording = async function () {
    if (s.listening) return;
    if (!f.checkBrowserSupport()) {
      f.updateBrowserWarning();
      return;
    }
    s.gen++;
    if (!s.voiceMode) {
      var input = f.getInput();
      var existing = input ? input.value.trim() : "";
      s.asrState = existing
        ? { interim: "", queue: existing, maxLen: existing.length, display: existing }
        : { interim: "", queue: "", maxLen: 0, display: "" };
      s.lastDisplay = existing;
      s.editState = "clean";
    } else {
      f.updateInput("");
      s.asrState = { interim: "", queue: "", maxLen: 0, display: "" };
      s.lastDisplay = "";
      s.editState = "clean";
    }
    s.engine = f.createEngine();
    var ok = await s.engine.start();
    if (!ok) {
      s.engine = null;
      return false;
    }
    s.listening = true;
    f.startTimer();
    f.playStartSound();
    if (s.errorToast) s.errorToast.classList.remove("active");
    f.updateAllBtnUI();
    f.resetSilence();
    return true;
  };

  f.stopRecording = function () {
    if (!s.listening) return;
    s.listening = false;
    f.stopTimer();
    f.playStopSound();
    if (s.silenceTimer) {
      clearTimeout(s.silenceTimer);
      s.silenceTimer = null;
    }
    if (s.asrState && s.asrState.interim) f.finalizeCurrent();
    if (s.engine) {
      s.engine.stop();
      s.engine = null;
    }
    s.editState = "clean";
    f.updateAllBtnUI();
  };

  f.showAsrError = function (msg) {
    if (!s.errorToast) {
      console.error("[Voice] showAsrError: errorToast is null, msg=" + msg);
      return;
    }
    try {
      f.stopRecording();
    } catch (e) {
      console.error(e);
    }
    if (s.errorToast) {
      s.errorToast.textContent = "\u274C " + msg;
      s.errorToast.classList.add("active");
      if (s.toastTimer) clearTimeout(s.toastTimer);
      s.toastTimer = setTimeout(function () {
        s.errorToast.classList.remove("active");
      }, 4000);
    }
  };

  f.toggleRecording = function () {
    s.retryCount = 0; // 用户手动操作，重置自动重连计数
    s.listening ? f.stopRecording() : f.startRecording();
  };

  f.setVoiceMode = function (on) {
    s.voiceMode = !!on;
    if (!s.listening) f.startRecording();
    f.updateAllBtnUI();
  };

  f.toggleVoiceMode = function () {
    f.setVoiceMode(!s.voiceMode);
  };

  f.syncVoiceModeFromConfig = function () {
    var cfg = window.VoiceInput.cfg;
    var target = cfg.default_mode === "hands-free";
    if (s.voiceMode !== target) {
      s.voiceMode = target;
      f.updateAllBtnUI();
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // 初始化
  // ═══════════════════════════════════════════════════════════════════
  f.init = function () {
    var cfg = window.VoiceInput.cfg;
    // 设置初始模式
    if (cfg.default_mode === "hands-free") s.voiceMode = true;
    // 构建退出词列表
    f.buildExitPhrases();
    // ── P0-1: 输入框编辑检测（委托到 voice-state.js 的 onInputEdit）──
    document.addEventListener(
      "input",
      function (e) {
        if (e.target && e.target.id === "user-input") {
          f.onInputEdit();
        }
      },
      true,
    );
    // ── 全局快捷键监听 ──
    document.addEventListener("keydown", function (e) {
      if (e.isComposing) return;
      if (e.target.tagName === "INPUT" && e.target.id !== "user-input") return;
      if (e.target.tagName === "TEXTAREA" && e.target.id !== "user-input") return;
      var action = f.matchShortcut(e);
      if (!action) return;
      e.preventDefault();
      s.retryCount = 0; // 用户手动快捷键操作，重置自动重连计数
      if (action === "toggle") f.toggleRecording();
      else if (action === "stop") f.stopRecording();
      else if (action === "start") f.startRecording();
      else if (action === "voice_mode") f.toggleVoiceMode();
    });
    // ── 发送按钮事件：语音识别中点击发送时，停止引擎并清空状态 ──
    var sendBtn = f.getSendBtn();
    if (sendBtn) {
      sendBtn.addEventListener(
        "click",
        function () {
          if (!s.listening || !s.engine) return;
          s.engine.onSend();
          s.asrState = { interim: "", queue: "", maxLen: 0, display: "" };
          s.lastDisplay = "";
        },
        true,
      );
    }
    f.updateAllBtnUI();
    f.updateBrowserWarning();
  };

  // ═══════════════════════════════════════════════════════════════════
  // 公共 API 导出（7个方法签名不变，保持兼容）
  // ═══════════════════════════════════════════════════════════════════
  VoiceCore.init = f.init;
  VoiceCore.createComposerUI = function () { return f.createComposerUI(); };
  VoiceCore.buildExitPhrases = function () { f.buildExitPhrases(); };
  VoiceCore.updateAllBtnUI = function () { f.updateAllBtnUI(); };
  VoiceCore.updateBrowserWarning = function () { f.updateBrowserWarning(); };
  VoiceCore.checkBrowserSupport = function () { return f.checkBrowserSupport(); };
  VoiceCore.syncVoiceModeFromConfig = function () { f.syncVoiceModeFromConfig(); };
  VoiceCore.updateComposerAlignment = function () { f.updateComposerAlignment(); };
})();
