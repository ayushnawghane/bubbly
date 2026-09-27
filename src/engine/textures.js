import { Graphics } from 'pixi.js';

// Bubble color palette + bomb/rainbow specials.
export const COLORS = ['#ff5d73', '#4fd6ff', '#ffd76a', '#7bff9e', '#c48bff', '#ff9f4a'];

const TEX_OPTS = { resolution: 2, antialias: true };

/**
 * Bake every bubble variant to a PIXI.Texture exactly once at startup.
 * Every bubble sprite on the board then reuses one of these ~8 textures,
 * so PixiJS auto-batches them into a single GPU draw call per frame instead
 * of recomputing a gradient per bubble per frame (the original lag source).
 */
export function buildTextureAtlas(app, radius) {
  const atlas = new Map();
  const size = radius * 2;

  for (const color of COLORS) {
    const g = new Graphics();
    const hex = Number('0x' + color.slice(1));
    g.circle(radius, radius, radius).fill({ color: hex });
    g.circle(radius * 0.62, radius * 0.6, radius * 0.32).fill({ color: 0xffffff, alpha: 0.35 });
    g.circle(radius, radius, radius).stroke({ width: Math.max(1, radius * 0.06), color: 0x000000, alpha: 0.15 });
    atlas.set(color, app.renderer.generateTexture({ target: g, ...TEX_OPTS }));
    g.destroy();
  }

  // Bomb
  {
    const g = new Graphics();
    g.circle(radius, radius, radius).fill({ color: 0x2b2540 });
    g.circle(radius, radius, radius).stroke({ width: Math.max(2, radius * 0.14), color: 0xff5d73 });
    g.circle(radius, radius, radius * 0.4).fill({ color: 0xff5d73 });
    atlas.set('bomb', app.renderer.generateTexture({ target: g, ...TEX_OPTS }));
    g.destroy();
  }

  // Rainbow (wedge segments standing in for a conic gradient)
  {
    const g = new Graphics();
    const segments = COLORS.length;
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const hex = Number('0x' + COLORS[i].slice(1));
      g.moveTo(radius, radius)
        .arc(radius, radius, radius, a0, a1)
        .lineTo(radius, radius)
        .fill({ color: hex });
    }
    g.circle(radius, radius, radius * 0.4).fill({ color: 0xffffff, alpha: 0.9 });
    atlas.set('rainbow', app.renderer.generateTexture({ target: g, ...TEX_OPTS }));
    g.destroy();
  }

  // Small plain white dot, reused (tinted per-instance) for particle bursts
  // and the aim bounce-preview trail — one more shared texture, no per-frame cost.
  {
    const g = new Graphics();
    const r = Math.max(3, radius * 0.14);
    g.circle(r, r, r).fill({ color: 0xffffff });
    atlas.set('dot', app.renderer.generateTexture({ target: g, ...TEX_OPTS }));
    g.destroy();
  }

  atlas.__size = size;
  return atlas;
}

export function randomColor(count) {
  return COLORS[Math.floor(Math.random() * count)];
}
