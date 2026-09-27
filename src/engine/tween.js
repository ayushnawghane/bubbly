// Minimal tween manager for the canvas layer — just enough for landing
// snaps, row-insert slides, and screen shake. No library needed for this few
// use cases.

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

export class TweenManager {
  constructor() {
    this.active = [];
  }

  /**
   * @param {object} opts
   * @param {number} opts.duration seconds
   * @param {(t:number)=>void} opts.onUpdate called each frame with eased progress 0..1
   * @param {()=>void} [opts.onComplete]
   * @param {(t:number)=>number} [opts.easing]
   */
  add({ duration, onUpdate, onComplete, easing = easeOutCubic }) {
    this.active.push({ elapsed: 0, duration, onUpdate, onComplete, easing });
  }

  update(dt) {
    for (const tw of this.active) {
      tw.elapsed += dt;
      const t = Math.min(tw.elapsed / tw.duration, 1);
      tw.onUpdate(tw.easing(t));
    }
    const finished = this.active.filter((tw) => tw.elapsed >= tw.duration);
    this.active = this.active.filter((tw) => tw.elapsed < tw.duration);
    for (const tw of finished) tw.onComplete && tw.onComplete();
  }
}
