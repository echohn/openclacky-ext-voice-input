// voice-input 扩展 - 引擎层模块（第4个加载）
// 职责：ASR引擎工厂、识别结果分发、静音检测、自动发送
// 引擎内部闭包变量（ws/myGen/stream/processor/source/audioCtxDs/rec/hasResult）保留不变
(function () {
  "use strict";
  if (!window.VoiceCore || !VoiceCore._s) return;

  var s = VoiceCore._s;
  var f = VoiceCore._f;

  // ═══════════════════════════════════════════════════════════════════
  // 浏览器原生 SpeechRecognition 引擎
  // ═══════════════════════════════════════════════════════════════════
  f.createBrowserEngine = function () {
    var rec = null;
    var myGen = 0;
    var hasResult = false;
    return {
      start: function () {
        var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) return false;
        var cfg = window.VoiceInput.cfg;
        rec = new SR();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = cfg.language || "zh-CN";
        myGen = s.gen;
        hasResult = false;
        rec.onresult = function (event) {
          if (!s.listening || s.gen !== myGen) return;
          var text = "";
          var isFinal = false;
          for (var i = event.resultIndex; i < event.results.length; i++) {
            text += event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              hasResult = true;
              isFinal = true;
            }
          }
          if (f.checkExit(text)) {
            f.stopRecording();
            return;
          }
          f.emitResult(text, isFinal);
        };
        rec.onerror = function (event) {
          if (event.error === "no-speech" || event.error === "aborted") return;
          f.stopRecording();
        };
        rec.onend = function () {
          if (!s.listening || s.gen !== myGen) return;
          if (s.voiceMode) {
            if (hasResult) {
              f.finalizeCurrent();
            } else {
              // 浏览器静音自动 stop，没有任何识别结果——重建引擎
              s.gen++;
              var cfg2 = window.VoiceInput.cfg;
              var delay2 = (cfg2 && cfg2.voice_mode_restart_delay_ms) || 300;
              if (s.silenceTimer) {
                clearTimeout(s.silenceTimer);
                s.silenceTimer = null;
              }
              setTimeout(function () {
                if (!s.listening || !s.voiceMode) return;
                var retries2 = 0, maxRetries2 = 3;
                (function tryRestartNoResult() {
                  if (!s.listening || !s.voiceMode) return;
                  s.asrState = { interim: "", queue: "", maxLen: 0, display: "" };
                  s.lastDisplay = "";
                  f.updateInput("");
                  s.engine = f.createEngine();
                  var ok2 = s.engine.start();
                  if (ok2) {
                    f.updateAllBtnUI();
                    f.resetSilence();
                  } else if (retries2 < maxRetries2) {
                    retries2++;
                    console.warn(
                      "[Voice-Browser] 无结果重启失败，" + retries2 * 200 +
                        "ms 后重试 (" + retries2 + "/" + maxRetries2 + ")",
                    );
                    setTimeout(tryRestartNoResult, retries2 * 200);
                  } else {
                    console.error("[Voice-Browser] 无结果重启彻底失败，回退 listening=false");
                    s.listening = false;
                    f.updateAllBtnUI();
                    f.updateBrowserWarning();
                  }
                })();
              }, delay2);
            }
          } else {
            f.stopRecording();
          }
        };
        try {
          rec.start();
          return true;
        } catch (e) {
          console.error("[Voice-Browser] start 异常", e);
          return false;
        }
      },
      stop: function () {
        try { rec && rec.stop(); } catch (e) {}
        rec = null;
      },
      onSend: function () {
        var myRound = s.gen + 1;
        if (rec) {
          try { rec.abort(); } catch (e) {}
          rec = null;
        }
        s.gen++;
        if (!s.listening) return;
        if (s.silenceTimer) {
          clearTimeout(s.silenceTimer);
          s.silenceTimer = null;
        }
        var cfg = window.VoiceInput.cfg;
        var delay = s.voiceMode ? cfg.voice_mode_restart_delay_ms || 300 : 150;
        var retries = 0, maxRetries = 3;
        function tryRestart() {
          if (!s.listening) return;
          if (!s.voiceMode) return;
          s.asrState = { interim: "", queue: "", maxLen: 0, display: "" };
          s.lastDisplay = "";
          f.updateInput("");
          s.engine = f.createEngine();
          var ok = s.engine.start();
          if (ok) {
            f.updateAllBtnUI();
            f.resetSilence();
          } else if (retries < maxRetries) {
            retries++;
            console.warn(
              "[Voice-Browser] r" + myRound + " 重建失败，" + retries * 200 +
                "ms 后重试 (" + retries + "/" + maxRetries + ")",
            );
            setTimeout(tryRestart, retries * 200);
          } else {
            console.error("[Voice-Browser] r" + myRound + " 重建彻底失败，回退 listening=false");
            s.listening = false;
            f.updateAllBtnUI();
            f.updateBrowserWarning();
          }
        }
        setTimeout(tryRestart, delay);
      },
    };
  };

  // ═══════════════════════════════════════════════════════════════════
  // DashScope WebSocket ASR 引擎
  // ═══════════════════════════════════════════════════════════════════
  f.createDashScopeEngine = function () {
    var ws = null, myGen = 0, audioCtxDs = null,
        stream = null, processor = null, source = null;
    return {
      start: async function () {
        myGen = s.gen;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { sampleRate: 16000, channelCount: 1 },
          });
        } catch (e) {
          return false;
        }
        var EXT = window.VoiceInput.ext;
        var cfg = window.VoiceInput.cfg;
        audioCtxDs = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        source = audioCtxDs.createMediaStreamSource(stream);
        processor = audioCtxDs.createScriptProcessor(4096, 1, 1);
        var proto = location.protocol === "https:" ? "wss:" : "ws:";
        var wsUrl = proto + "//" + location.host + "/api/ext/" + EXT + "/asr-ws";
        try {
          var infoResp = await fetch("/api/ext/" + EXT + "/ws-port");
          var info = await infoResp.json();
          if (info.port) wsUrl = "ws://" + info.host + ":" + info.port;
        } catch (e) {}
        ws = new WebSocket(wsUrl);
        ws.binaryType = "arraybuffer";
        ws.onopen = function () {
          ws.send(
            JSON.stringify({
              header: { action: "run-task", task_id: "voice-" + Date.now(), streaming: "duplex" },
              payload: {
                model: (cfg.asr && cfg.asr.model) || "paraformer-realtime-v1",
                task_group: "audio",
                task: "asr",
                function: "recognition",
                parameters: {
                  format: "pcm",
                  sample_rate: 16000,
                  language_hints: [cfg.language || "zh-CN"],
                },
                input: {},
              },
            }),
          );
        };
        ws.onmessage = function (event) {
          if (!s.listening || s.gen !== myGen) return;
          try {
            var msg = JSON.parse(event.data);
            var output = (msg.payload || {}).output || {};
            var sentence = output.sentence || {};
            var text = sentence.text || "";
            var isEnd = sentence.end_time != null && sentence.end_time > 0;
            if (text && f.checkExit(text)) {
              f.stopRecording();
              return;
            }
            f.emitResult(text, isEnd);
          } catch (e) {}
        };
        ws.onerror = function () {};
        ws.onclose = function (event) {
          if (!s.listening || s.gen !== myGen) return;
          var cfg2 = window.VoiceInput.cfg;
          if (event.code === 1006) {
            f.showAsrError("连接异常中断，请检查网络或重试");
            return;
          }
          if (event.code !== 1000 && event.code !== 1001) {
            var errMsg = "连接失败";
            try {
              var err = JSON.parse(event.reason || "{}");
              errMsg = err.error || errMsg;
            } catch (e) {
              errMsg = event.reason || errMsg;
            }
            f.showAsrError(errMsg);
            return;
          }
          // 自动重连：最多重试 3 次，指数退避（baseDelay × 1.5^retryCount）
          // retryCount 仅在用户手动操作（toggleRecording / 快捷键）时重置
          if (s.voiceMode && s.retryCount < 3) {
            f.stopRecording();
            s.retryCount++;
            var currentGen = s.gen;
            var delay = (cfg2.voice_mode_restart_delay_ms || 300) * Math.pow(1.5, s.retryCount - 1);
            setTimeout(function () {
              if (s.voiceMode && s.gen === currentGen) f.startRecording();
            }, delay);
          }
        };
        source.connect(processor);
        processor.connect(audioCtxDs.destination);
        processor.onaudioprocess = function (e) {
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          var input = e.inputBuffer.getChannelData(0);
          var pcm = new Int16Array(input.length);
          for (var i = 0; i < input.length; i++) {
            var clamped = Math.max(-1, Math.min(1, input[i]));
            pcm[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
          }
          ws.send(pcm.buffer);
        };
        return true;
      },
      stop: function () {
        if (processor) { processor.disconnect(); processor = null; }
        if (source) { source.disconnect(); source = null; }
        if (audioCtxDs) { audioCtxDs.close(); audioCtxDs = null; }
        if (stream) {
          stream.getTracks().forEach(function (t) { t.stop(); });
          stream = null;
        }
        if (ws) {
          try {
            ws.send(
              JSON.stringify({
                header: { task_id: "voice-" + Date.now(), action: "finish-task", streaming: "duplex" },
                payload: { input: {} },
              }),
            );
          } catch (e) {}
          try { ws.close(); } catch (e) {}
          ws = null;
        }
      },
      onSend: function () {
        // 与 Browser 引擎的 onSend 对齐：gen++ + 清理连接 + 语音模式下重建
        s.gen++;
        myGen = s.gen;
        // 关闭当前 WS 连接，避免旧连接的回调干扰
        if (ws) {
          try { ws.close(); } catch (e) {}
          ws = null;
        }
        if (processor) { processor.disconnect(); processor = null; }
        if (source) { source.disconnect(); source = null; }
        if (audioCtxDs) { audioCtxDs.close(); audioCtxDs = null; }
        if (stream) {
          stream.getTracks().forEach(function (t) { t.stop(); });
          stream = null;
        }
        if (s.silenceTimer) {
          clearTimeout(s.silenceTimer);
          s.silenceTimer = null;
        }
        var cfg2 = window.VoiceInput.cfg;
        var delay = s.voiceMode ? (cfg2.voice_mode_restart_delay_ms || 300) : 150;
        var retries = 0, maxRetries = 3;
        function tryRestart() {
          if (!s.listening) return;
          if (!s.voiceMode) return;
          s.asrState = { interim: "", queue: "", maxLen: 0, display: "" };
          s.lastDisplay = "";
          f.updateInput("");
          s.engine = f.createEngine();
          s.engine.start().then(function (ok) {
            if (ok) {
              f.updateAllBtnUI();
              f.resetSilence();
            } else if (retries < maxRetries) {
              retries++;
              console.warn(
                "[Voice-DashScope] onSend 重建失败，" + retries * 200 +
                  "ms 后重试 (" + retries + "/" + maxRetries + ")",
              );
              setTimeout(tryRestart, retries * 200);
            } else {
              console.error("[Voice-DashScope] onSend 重建彻底失败，回退 listening=false");
              s.listening = false;
              f.updateAllBtnUI();
              f.updateBrowserWarning();
            }
          });
        }
        setTimeout(tryRestart, delay);
      },
    };
  };

  // ═══════════════════════════════════════════════════════════════════
  // 引擎工厂
  // ═══════════════════════════════════════════════════════════════════
  f.createEngine = function () {
    var cfg = window.VoiceInput.cfg;
    var isDs = cfg.asr && cfg.asr.provider === "dashscope";
    return isDs ? f.createDashScopeEngine() : f.createBrowserEngine();
  };

  // ═══════════════════════════════════════════════════════════════════
  // 识别结果分发（状态机驱动）
  // ═══════════════════════════════════════════════════════════════════
  f.emitResult = function (text, isFinal) {
    if (!text) return;
    f.ensureSessionBuffer();
    if (isFinal) {
      if (s.editState === "editing") {
        f.absorbEditsForFinal(text);
        s.editState = "clean";
      } else if (s.editState === "cleared") {
        s.asrState = { interim: "", queue: text, maxLen: text.length, display: text };
        f.updateInput(s.asrState.display);
        s.editState = "clean";
      } else {
        f.absorbEdits();
        s.asrState = f.processResult(text, true);
        f.updateInput(s.asrState.display);
      }
    } else {
      s.asrState = f.processResult(text, false);
      if (s.editState === "clean") {
        f.updateInput(s.asrState.display);
      }
    }
    f.resetSilence();
  };

  // ── 静音计时器 ──
  f.resetSilence = function () {
    if (s.silenceTimer) clearTimeout(s.silenceTimer);
    var cfg = window.VoiceInput.cfg;
    s.silenceTimer = setTimeout(function () {
      if (!s.listening) return;
      f.finalizeCurrent();
    }, cfg.silence_timeout_ms || 1500);
  };

  f.finalizeCurrent = function () {
    if (!s.listening) return;
    // Guard: 无 ASR 识别结果时不提交（避免手动输入被 silence timer 误提交）
    if (!s.asrState.interim && !s.asrState.queue) {
      f.resetSilence();
      return;
    }
    if (s.voiceMode) {
      // P0-1: 发送前先吸收用户的编辑
      if (s.editState === "editing") {
        var input = f.getInput();
        if (input && input.value.trim()) {
          s.asrState.queue = input.value.trim();
          s.asrState.display = s.asrState.queue;
          s.lastDisplay = s.asrState.queue;
        }
      }
      var sendBtn = f.getSendBtn();
      if (sendBtn) sendBtn.click();
      s.asrState = { interim: "", queue: "", maxLen: 0, display: "" };
      s.lastDisplay = "";
      s.editState = "clean";
    }
  };
})();
