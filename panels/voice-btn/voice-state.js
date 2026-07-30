// voice-input 扩展 - 状态层模块（第2个加载）
// 职责：ASR文本状态管理、会话级缓冲区隔离、输入框操作、编辑检测
(function () {
  "use strict";
  if (!window.VoiceCore || !VoiceCore._s) return;

  var s = VoiceCore._s;
  var f = VoiceCore._f;

  // ═══════════════════════════════════════════════════════════════════
  // 文本处理
  // ═══════════════════════════════════════════════════════════════════
  f.processResult = function (text, isFinal) {
    if (!text) return s.asrState;
    var st = s.asrState || { interim: "", queue: "", maxLen: 0 };
    if (isFinal !== undefined) {
      if (isFinal) {
        if (text.trim()) st.queue = (st.queue ? st.queue + "\n" : "") + text;
        st.interim = "";
      } else {
        st.interim = text;
      }
    } else {
      if (st.maxLen > 0 && text.length <= st.maxLen * 0.5) {
        if (st.interim.trim())
          st.queue = (st.queue ? st.queue + " " : "") + st.interim;
        st.maxLen = text.length;
      } else if (text.length > st.maxLen) {
        st.maxLen = text.length;
      }
      st.interim = text;
    }
    st.display =
      st.queue && st.interim ? st.queue + "\n" + st.interim : st.queue || st.interim;
    return st;
  };

  // ── 输入框操作 ──
  f.getInput = function () {
    return document.getElementById("user-input");
  };

  f.getSendBtn = function () {
    return document.getElementById("btn-send");
  };

  f.updateInput = function (text) {
    f.ensureSessionBuffer();
    var input = f.getInput();
    if (input) {
      input.value = text || "";
      // P0-1: 先更新 lastDisplay，再 dispatch input 事件
      // 这样 onInputEdit 中 val === lastDisplay 判断成立，不会误触发 editState
      s.lastDisplay = text || "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };

  f.absorbEdits = function () {
    var input = f.getInput();
    if (!input) return;
    var val = (input.value || "").trim();
    if (val && val !== s.lastDisplay && s.asrState) {
      s.asrState.queue = val;
      s.asrState.interim = "";
      s.asrState.display = val;
      s.lastDisplay = val;
    }
  };

  f.checkExit = function (text) {
    if (!text || s.exitPhrases.length === 0) return false;
    var lower = text.toLowerCase().trim();
    for (var i = 0; i < s.exitPhrases.length; i++) {
      var phrase = s.exitPhrases[i];
      if (lower === phrase || lower.startsWith(phrase) || lower.endsWith(phrase))
        return true;
    }
    return false;
  };

  // ── P0-2: 会话隔离 ──
  f.currentSessionId = function () {
    var hash = location.hash || "";
    var match = hash.match(/#session\/([a-f0-9]+)/i);
    if (match) return match[1];
    var input = document.getElementById("user-input");
    if (input) {
      var el = input.closest("[data-session-id]");
      if (el) return el.dataset.sessionId;
    }
    return "default";
  };

  // 惰性清理：会话缓冲区超过 20 个时，删除最早未使用的
  // 每个 buffer 约 200 bytes，实际内存影响极小，但防止长期使用无限增长
  f.cleanupSessionBuffers = function () {
    var keys = Object.keys(s.sessionBuffers);
    if (keys.length <= 20) return;
    // 保留当前活跃会话，按 key 顺序删除最早的
    for (var i = 0; i < keys.length && keys.length > 20; i++) {
      if (keys[i] !== s.activeSessionId) {
        delete s.sessionBuffers[keys[i]];
      }
    }
  };

  f.ensureSessionBuffer = function () {
    var sid = f.currentSessionId();
    if (sid === s.activeSessionId) return;
    // 保存旧会话缓冲区
    if (s.activeSessionId) {
      f.absorbEdits(); // 保存前先吸收当前编辑，防止用户编辑丢失
      s.sessionBuffers[s.activeSessionId] = {
        asrState: s.asrState,
        lastDisplay: s.lastDisplay,
        editState: s.editState,
      };
    }
    // 加载新会话缓冲区
    var buf = s.sessionBuffers[sid];
    if (buf) {
      s.asrState = buf.asrState;
      s.lastDisplay = buf.lastDisplay;
      s.editState = buf.editState || "clean";
      // 恢复输入框内容（仅当新会话输入框为空且旧缓冲区有内容时）
      var input = f.getInput();
      if (input && !input.value && s.asrState && s.asrState.display) {
        input.value = s.asrState.display;
        s.lastDisplay = s.asrState.display; // 先设 lastDisplay，再 dispatch
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    } else {
      s.asrState = null;
      s.lastDisplay = "";
      s.editState = "clean";
    }
    s.activeSessionId = sid;
    f.cleanupSessionBuffers();
  };

  // ── P0-1: 吸收编辑 + 追加 final（editing 状态下 final 到达）──
  f.absorbEditsForFinal = function (finalText) {
    var input = f.getInput();
    if (!input) return;
    var userText = (input.value || "").trim();
    if (!userText) {
      // 用户清空了输入框，回退到 cleared 逻辑
      s.asrState = { interim: "", queue: finalText, maxLen: 0, display: finalText };
      f.updateInput(s.asrState.display);
      return;
    }
    // 吸收用户编辑后的内容 + 追加 final
    s.asrState.queue = userText + "\n" + finalText;
    s.asrState.interim = "";
    s.asrState.display = s.asrState.queue;
    f.updateInput(s.asrState.display);
  };

  // ── P0-1: 输入框编辑检测（从 init 中提取为独立函数）──
  f.onInputEdit = function () {
    var input = f.getInput();
    if (!input) return;
    var val = input.value || "";
    // updateInput 中先设 lastDisplay 再 dispatch，所以程序化更新时 val === lastDisplay，不会误触发
    if (val === s.lastDisplay) return;
    if (val === "" && s.lastDisplay !== "") {
      s.editState = "cleared";
    } else {
      s.editState = "editing";
    }
  };
})();
