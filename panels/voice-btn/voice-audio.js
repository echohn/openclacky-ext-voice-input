// voice-input 扩展 - 音效层模块（第3个加载）
// 职责：录音开始/停止音效播放
// audioCtx 为模块局部变量，不放入共享状态
(function () {
  "use strict";
  if (!window.VoiceCore || !VoiceCore._s) return;

  var f = VoiceCore._f;
  var audioCtx = null;

  f.getAudioCtx = function () {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {}
    }
    return audioCtx;
  };

  f.playSoundFile = function (filename) {
    if (!filename || filename === "none" || filename === "default") return false;
    try {
      var cfg = window.VoiceInput.cfg;
      var a = new Audio(
        "/api/ext/" + window.VoiceInput.ext + "/sounds/" + encodeURIComponent(filename),
      );
      a.volume = (cfg.sound && cfg.sound.volume) || 0.4;
      a.play().catch(function () {
        console.warn("[voice-input] 音效播放失败:", filename);
      });
      return true;
    } catch (e) {
      return false;
    }
  };

  f.playBeep = function (freq, duration, type) {
    var ctx = f.getAudioCtx();
    if (!ctx) return;
    var cfg = window.VoiceInput.cfg;
    var vol = (cfg.sound && cfg.sound.volume) || 0.4;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || "sine";
    osc.frequency.value = freq;
    gain.gain.value = vol * 0.3;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  };

  f.playStartSound = function () {
    var cfg = window.VoiceInput.cfg;
    var snd = cfg.sound || {};
    var file = snd.start || "default";
    if (file === "none") return;
    if (file !== "default" && f.playSoundFile(file)) return;
    f.playBeep(880, 0.15, "sine");
  };

  f.playStopSound = function () {
    var cfg = window.VoiceInput.cfg;
    var snd = cfg.sound || {};
    var file = snd.stop || "default";
    if (file === "none") return;
    if (file !== "default" && f.playSoundFile(file)) return;
    f.playBeep(440, 0.25, "sine");
  };
})();
