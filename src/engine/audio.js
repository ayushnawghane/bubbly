// Tiny WebAudio synth for sound effects — no audio files to fetch/cache.
// Also fires short haptic pulses on supported devices.

function vibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  ensureContext() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  tone(freq, duration, type = 'sine', gain = 0.15) {
    if (this.muted) return;
    const ctx = this.ensureContext();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.value = gain;
    osc.connect(g).connect(ctx.destination);
    const now = ctx.currentTime;
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.start(now);
    osc.stop(now + duration);
  }

  shoot() {
    this.tone(520, 0.08, 'triangle', 0.08);
  }

  pop(comboIndex = 0) {
    this.tone(440 + comboIndex * 60, 0.12, 'square', 0.1);
    vibrate(12);
  }

  bomb() {
    this.tone(90, 0.35, 'sawtooth', 0.18);
    vibrate([20, 30, 40]);
  }

  gameOver() {
    if (this.muted) return;
    this.tone(300, 0.2, 'sine', 0.12);
    setTimeout(() => this.tone(180, 0.35, 'sine', 0.12), 140);
    vibrate([30, 40, 30]);
  }

  setMuted(muted) {
    this.muted = muted;
  }
}
