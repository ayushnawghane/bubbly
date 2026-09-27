import { Application, Container, Graphics, Sprite, Text } from 'pixi.js';
import { HexGrid } from './grid.js';
import { popMatchesAt, popBomb, dropFloatingBubbles } from './matcher.js';
import { Aimer, Projectile, findGridCollision, predictBouncePath } from './shooter.js';
import { TweenManager, lerp } from './tween.js';
import { buildTextureAtlas, COLORS } from './textures.js';
import { Audio } from './audio.js';
import { getHighScore, submitScore, touchDailyStreak } from './storage.js';

const COLS = 8;
const PREFILL_ROWS = 5;
const INITIAL_COLORS = 4;
const INITIAL_ROW_INTERVAL = 14000;
const MIN_ROW_INTERVAL = 5000;
const ROW_INTERVAL_STEP = 450;
const POWERUP_START_SCORE = 300;
const INITIAL_SHUFFLES = 3;

function hexToInt(color) {
  return Number('0x' + color.replace('#', ''));
}

/**
 * Owns the PIXI.Application and the whole game simulation. React never
 * touches this loop directly — it creates one instance, calls start()/
 * shuffleCurrentBubble()/setMuted() from UI event handlers, and reads
 * game state only through the callbacks below (which the caller wires to
 * the Zustand store). This keeps the 60fps loop entirely inside PixiJS's
 * own ticker, untouched by React's render cycle.
 */
export class GameEngine {
  constructor(container, callbacks = {}) {
    this.container = container;
    this.callbacks = callbacks; // onScore, onBest, onStreak, onCombo, onShuffles, onGameOver
    this.app = null;
    this.destroyed = false;
    this.state = 'idle'; // 'idle' | 'playing' | 'gameover'
    this.sprites = new Map(); // "r,c" -> Sprite
    this.tweens = new TweenManager();
    this.particles = [];
    this.audio = new Audio();
    this.aimer = new Aimer();
    this.pointerActive = false;
    this._onKeyDown = this._onKeyDown.bind(this);
  }

  async init() {
    const app = new Application();
    await app.init({ resizeTo: this.container, backgroundAlpha: 0, antialias: true });
    if (this.destroyed) {
      app.destroy(true);
      return;
    }
    this.app = app;
    this.container.appendChild(app.canvas);

    this.worldContainer = new Container();
    this.killLineGraphics = new Graphics();
    this.gridLayer = new Container();
    this.effectsLayer = new Container();
    this.aimGraphics = new Graphics();
    this.shooterLayer = new Container();
    this.worldContainer.addChild(
      this.killLineGraphics, this.gridLayer, this.effectsLayer, this.aimGraphics, this.shooterLayer
    );
    app.stage.addChild(this.worldContainer);

    this._computeLayout();
    this.textures = buildTextureAtlas(app, this.cellSize / 2);

    this.currentSprite = new Sprite(this.textures.get(COLORS[0]));
    this.currentSprite.anchor.set(0.5);
    this.nextSprite = new Sprite(this.textures.get(COLORS[0]));
    this.nextSprite.anchor.set(0.5);
    this.shooterLayer.addChild(this.currentSprite, this.nextSprite);

    this._bindInput();

    this._resizeObserver = new ResizeObserver(() => this._computeLayout(true));
    this._resizeObserver.observe(this.container);

    app.ticker.add((ticker) => this._tick(ticker.deltaMS / 1000));
  }

  // ---------- layout ----------

  _computeLayout(relayout = false) {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    this.width = w;
    this.height = h;
    this.cellSize = w / COLS;
    this.boardLeft = 0;
    this.boardRight = w;
    this.topY = 96;
    this.killLineY = h - 120;
    this.shooterX = w / 2;
    this.shooterY = h - 70;

    if (this.grid) {
      this.grid.cellSize = this.cellSize;
      this.grid.rowHeight = this.cellSize * 0.87;
      this.grid.boardLeft = this.boardLeft;
      this.grid.topY = this.topY;
      if (relayout) this._relayoutSprites();
    }
    if (this.currentSprite) {
      const diameter = this.cellSize - 3;
      this.currentSprite.position.set(this.shooterX, this.shooterY);
      this.currentSprite.width = diameter;
      this.currentSprite.height = diameter;
      this.nextSprite.position.set(this.shooterX + this.cellSize * 1.4, this.shooterY);
      this.nextSprite.width = this.cellSize * 0.66;
      this.nextSprite.height = this.cellSize * 0.66;
    }
  }

  _relayoutSprites() {
    const diameter = this.cellSize - 3;
    for (const [key, sprite] of this.sprites) {
      const [r, c] = key.split(',').map(Number);
      const { x, y } = this.grid.cellCenter(r, c);
      sprite.position.set(x, y);
      sprite.width = diameter;
      sprite.height = diameter;
    }
  }

  // ---------- input ----------

  _bindInput() {
    const canvas = this.app.canvas;
    canvas.style.touchAction = 'none';

    const getPos = (e) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const onDown = (e) => {
      if (this.state !== 'playing') return;
      this.pointerActive = true;
      const p = getPos(e);
      this.aimer.aimAt(this.shooterX, this.shooterY, p.x, p.y);
    };
    const onMove = (e) => {
      if (this.state !== 'playing' || !this.pointerActive) return;
      const p = getPos(e);
      this.aimer.aimAt(this.shooterX, this.shooterY, p.x, p.y);
    };
    const onUp = () => {
      if (!this.pointerActive) return;
      this.pointerActive = false;
      this.shoot();
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', this._onKeyDown);

    this._cleanupInput = () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', this._onKeyDown);
    };
  }

  _onKeyDown(e) {
    if (this.state !== 'playing') return;
    if (e.key === 'ArrowLeft') this.aimer.nudge(-0.05);
    else if (e.key === 'ArrowRight') this.aimer.nudge(0.05);
    else if (e.key === ' ') { e.preventDefault(); this.shoot(); }
  }

  // ---------- lifecycle ----------

  start() {
    this.grid = new HexGrid(COLS, this.cellSize, this.boardLeft, this.topY);
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.bubblesPopped = 0;
    this.activeColorCount = INITIAL_COLORS;
    this.rowInterval = INITIAL_ROW_INTERVAL;
    this.timeSinceLastRow = 0;
    this.projectile = null;
    this.gameOverTriggered = false;
    this.shuffles = INITIAL_SHUFFLES;

    for (const sprite of this.sprites.values()) sprite.destroy();
    this.sprites.clear();
    this.gridLayer.removeChildren();
    this.effectsLayer.removeChildren();
    if (this.projectileSprite) { this.projectileSprite.destroy(); this.projectileSprite = null; }
    this.tweens = new TweenManager();
    this.particles = [];
    this.worldContainer.position.set(0, 0);

    for (let r = 0; r < PREFILL_ROWS; r++) {
      const cols = this.grid.colsInRow(r);
      const row = [];
      for (let c = 0; c < cols; c++) {
        const cell = { color: this._randomColor() };
        row.push(cell);
        this._createSprite(r, c, cell);
      }
      this.grid.rows[r] = row;
    }

    this.currentBubble = this._spawnBubble();
    this.nextBubble = this._spawnBubble();
    this._updateShooterSprites();

    const streak = touchDailyStreak();
    const best = getHighScore();
    this.callbacks.onScore?.(0);
    this.callbacks.onCombo?.(0);
    this.callbacks.onShuffles?.(this.shuffles);
    this.callbacks.onStreak?.(streak);
    this.callbacks.onBest?.(best);

    this.state = 'playing';
  }

  shoot() {
    if (this.state !== 'playing' || this.projectile) return;
    this.projectile = new Projectile(
      this.shooterX, this.shooterY, this.aimer.angle,
      this.currentBubble.color, this.currentBubble.type, this.cellSize / 2
    );
    const diameter = this.cellSize - 3;
    this.projectileSprite = new Sprite(this.textures.get(this.currentBubble.type || this.currentBubble.color));
    this.projectileSprite.anchor.set(0.5);
    this.projectileSprite.width = diameter;
    this.projectileSprite.height = diameter;
    this.projectileSprite.position.set(this.projectile.x, this.projectile.y);
    this.gridLayer.addChild(this.projectileSprite);
    this.audio.shoot();

    this.currentBubble = this.nextBubble;
    this.nextBubble = this._spawnBubble();
    this._updateShooterSprites();
  }

  shuffleCurrentBubble() {
    if (this.state !== 'playing' || this.shuffles <= 0) return;
    const palette = this._boardColors().filter((c) => c !== this.currentBubble.color);
    const pool = palette.length ? palette : this._boardColors();
    this.currentBubble = { color: pool[Math.floor(Math.random() * pool.length)] };
    this.shuffles -= 1;
    this._updateShooterSprites();
    this.callbacks.onShuffles?.(this.shuffles);
    this.audio.tone(700, 0.08, 'sine', 0.08);
  }

  setMuted(muted) {
    this.audio.setMuted(muted);
  }

  // ---------- bubble spawning ----------

  _randomColor() {
    return COLORS[Math.floor(Math.random() * this.activeColorCount)];
  }

  _boardColors() {
    const present = new Set();
    this.grid.forEach((cell) => { if (!cell.type) present.add(cell.color); });
    return present.size ? Array.from(present) : COLORS.slice(0, this.activeColorCount);
  }

  _spawnBubble() {
    const powerupChance = this.score >= POWERUP_START_SCORE
      ? Math.min(0.18, (this.score - POWERUP_START_SCORE) / 4000)
      : 0;
    if (Math.random() < powerupChance) {
      return Math.random() < 0.5 ? { color: '#ffffff', type: 'bomb' } : { color: '#ffffff', type: 'rainbow' };
    }
    const palette = this._boardColors();
    return { color: palette[Math.floor(Math.random() * palette.length)] };
  }

  _updateShooterSprites() {
    const diameter = this.cellSize - 3;
    this.currentSprite.texture = this.textures.get(this.currentBubble.type || this.currentBubble.color);
    this.currentSprite.width = diameter;
    this.currentSprite.height = diameter;
    const nextDiameter = this.cellSize * 0.66;
    this.nextSprite.texture = this.textures.get(this.nextBubble.type || this.nextBubble.color);
    this.nextSprite.width = nextDiameter;
    this.nextSprite.height = nextDiameter;
  }

  // ---------- sprite <-> grid sync ----------

  _createSprite(r, c, cell) {
    const tex = this.textures.get(cell.type || cell.color);
    const sprite = new Sprite(tex);
    sprite.anchor.set(0.5);
    const diameter = this.cellSize - 3;
    sprite.width = diameter;
    sprite.height = diameter;
    const { x, y } = this.grid.cellCenter(r, c);
    sprite.position.set(x, y);
    sprite.bubbleColor = cell.color;
    this.gridLayer.addChild(sprite);
    this.sprites.set(`${r},${c}`, sprite);
    return sprite;
  }

  _popSpriteAt(r, c) {
    const key = `${r},${c}`;
    const sprite = this.sprites.get(key);
    if (!sprite) return;
    this.sprites.delete(key);
    this._burstParticles(sprite.x, sprite.y, hexToInt(sprite.bubbleColor || '#ffffff'), 8);
    const startScale = sprite.scale.x;
    this.tweens.add({
      duration: 0.16,
      onUpdate: (t) => {
        sprite.scale.set(lerp(startScale, startScale * 1.5, t));
        sprite.alpha = 1 - t;
      },
      onComplete: () => sprite.destroy(),
    });
  }

  _dropSpriteAt(r, c) {
    const key = `${r},${c}`;
    const sprite = this.sprites.get(key);
    if (!sprite) return;
    this.sprites.delete(key);
    this._burstParticles(sprite.x, sprite.y, hexToInt(sprite.bubbleColor || '#ffd76a'), 5);
    const startY = sprite.y;
    this.tweens.add({
      duration: 0.35,
      easing: (t) => t,
      onUpdate: (t) => { sprite.y = startY + t * t * 260; sprite.alpha = 1 - t; },
      onComplete: () => sprite.destroy(),
    });
  }

  // ---------- effects ----------

  _burstParticles(x, y, colorHex, count = 8) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 220;
      const sprite = new Sprite(this.textures.get('dot'));
      sprite.anchor.set(0.5);
      sprite.tint = colorHex;
      const size = 4 + Math.random() * 5;
      sprite.width = size;
      sprite.height = size;
      sprite.position.set(x, y);
      this.effectsLayer.addChild(sprite);
      this.particles.push({ sprite, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1, decay: 1.6 + Math.random() * 1.2 });
    }
  }

  _spawnComboText(x, y, points, combo) {
    const label = combo > 1 ? `+${points}  x${combo}` : `+${points}`;
    const text = new Text({
      text: label,
      style: { fill: 0xffffff, fontSize: 18, fontWeight: '800', fontFamily: 'sans-serif', stroke: { color: 0x140f24, width: 3 } },
    });
    text.anchor.set(0.5);
    text.position.set(x, y);
    this.effectsLayer.addChild(text);
    const startY = y;
    this.tweens.add({
      duration: 0.6,
      onUpdate: (t) => { text.y = lerp(startY, startY - 40, t); text.alpha = 1 - t; },
      onComplete: () => text.destroy(),
    });
  }

  _shake() {
    const container = this.worldContainer;
    this.tweens.add({
      duration: 0.18,
      easing: (t) => t,
      onUpdate: (t) => {
        const decay = 1 - t;
        container.position.set((Math.random() - 0.5) * 10 * decay, (Math.random() - 0.5) * 10 * decay);
      },
      onComplete: () => container.position.set(0, 0),
    });
  }

  // ---------- difficulty ----------

  _maybeEscalate() {
    if (this.score > 400 * (this.activeColorCount - INITIAL_COLORS + 1) && this.activeColorCount < COLORS.length) {
      this.activeColorCount += 1;
    }
  }

  _pushNewRow() {
    const rowData = [];
    for (let c = 0; c < COLS; c++) rowData.push({ color: this._randomColor() });

    const oldSprites = this.sprites;
    this.sprites = new Map();
    for (const [key, sprite] of oldSprites) {
      const [r, c] = key.split(',').map(Number);
      this.sprites.set(`${r + 1},${c}`, sprite);
      const fromY = sprite.y;
      const toY = fromY + this.grid.rowHeight;
      this.tweens.add({ duration: 0.2, onUpdate: (t) => { sprite.y = lerp(fromY, toY, t); } });
    }

    this.grid.unshiftRow(rowData);

    for (let c = 0; c < COLS; c++) {
      const sprite = this._createSprite(0, c, rowData[c]);
      const finalY = sprite.y;
      const startY = finalY - this.grid.rowHeight;
      sprite.y = startY;
      sprite.alpha = 0;
      sprite.scale.set(0.6);
      this.tweens.add({
        duration: 0.2,
        onUpdate: (t) => {
          sprite.y = lerp(startY, finalY, t);
          sprite.alpha = t;
          sprite.scale.set(lerp(0.6, 1, t));
        },
      });
    }

    this.rowInterval = Math.max(MIN_ROW_INTERVAL, this.rowInterval - ROW_INTERVAL_STEP);
  }

  // ---------- landing / matching ----------

  _land() {
    const proj = this.projectile;
    this.projectile = null;
    if (this.projectileSprite) { this.projectileSprite.destroy(); this.projectileSprite = null; }

    const [r, c] = this.grid.nearestEmptyCell(proj.x, Math.max(proj.y, this.topY + this.cellSize / 2));
    const placed = { color: proj.color, type: proj.type };
    this.grid.set(r, c, placed);
    const sprite = this._createSprite(r, c, placed);

    const targetX = sprite.x;
    const targetY = sprite.y;
    sprite.position.set(proj.x, proj.y);
    this.tweens.add({
      duration: 0.09,
      onUpdate: (t) => { sprite.x = lerp(proj.x, targetX, t); sprite.y = lerp(proj.y, targetY, t); },
    });

    let popped;
    if (proj.type === 'bomb') {
      popped = popBomb(this.grid, r, c, 1);
      this.audio.bomb();
      this._shake();
    } else {
      popped = popMatchesAt(this.grid, r, c);
    }

    if (popped.length) {
      this.combo += 1;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.bubblesPopped += popped.length;
      const gained = 10 * popped.length * this.combo;
      this.score += gained;
      this.audio.pop(this.combo);

      for (const [pr, pc] of popped) this._popSpriteAt(pr, pc);
      this._spawnComboText(targetX, targetY, gained, this.combo);

      const floating = dropFloatingBubbles(this.grid);
      if (floating.length) {
        this.bubblesPopped += floating.length;
        this.score += floating.length * 20;
        for (const [fr, fc] of floating) this._dropSpriteAt(fr, fc);
      }
    } else {
      this.combo = 0;
    }

    this._maybeEscalate();
    this.callbacks.onScore?.(this.score);
    this.callbacks.onCombo?.(this.combo);
    this._checkGameOver();
  }

  _checkGameOver() {
    if (this.gameOverTriggered) return;
    for (let r = 0; r < this.grid.rows.length; r++) {
      const bottomOfRow = this.topY + (r + 1) * this.grid.rowHeight;
      if (bottomOfRow >= this.killLineY && this.grid.rows[r].some(Boolean)) {
        this._gameOver();
        return;
      }
    }
  }

  _gameOver() {
    this.gameOverTriggered = true;
    this.state = 'gameover';
    this.audio.gameOver();
    const isNewBest = submitScore(this.score);
    this.callbacks.onGameOver?.({
      score: this.score,
      isNewBest,
      best: getHighScore(),
      bubblesPopped: this.bubblesPopped,
      bestCombo: this.bestCombo,
    });
  }

  _isNearKillLine() {
    if (!this.grid || !this.grid.rows.length) return false;
    for (let r = 0; r < this.grid.rows.length; r++) {
      const bottomOfRow = this.topY + (r + 1) * this.grid.rowHeight;
      if (bottomOfRow >= this.killLineY - this.grid.rowHeight * 2 && this.grid.rows[r].some(Boolean)) return true;
    }
    return false;
  }

  // ---------- main loop ----------

  _tick(rawDt) {
    // Clamp dt so a frame hiccup (tab throttling, a heavy GC pause, slow
    // device) can't let the projectile tunnel through the grid in one step —
    // the collision check only scans a small row window around its position.
    const dt = Math.min(rawDt, 0.032);
    this.tweens.update(dt);
    this._updateParticles(dt);
    this._drawKillLine();

    if (this.state !== 'playing') return;

    this.timeSinceLastRow += dt * 1000;
    if (this.timeSinceLastRow >= this.rowInterval) {
      this.timeSinceLastRow = 0;
      this._pushNewRow();
      this._checkGameOver();
    }

    if (this.projectile) {
      const bounds = { left: this.boardLeft, right: this.boardRight, top: this.topY };
      const hitTop = this.projectile.advance(dt, bounds);
      if (this.projectileSprite) this.projectileSprite.position.set(this.projectile.x, this.projectile.y);
      const hit = hitTop || !!findGridCollision(this.grid, this.projectile);
      if (hit) this._land();
    }

    this._drawAimLine();
  }

  _updateParticles(dt) {
    for (const p of this.particles) {
      p.vy += 420 * dt;
      p.sprite.x += p.vx * dt;
      p.sprite.y += p.vy * dt;
      p.life -= p.decay * dt;
      p.sprite.alpha = Math.max(p.life, 0);
    }
    const dead = this.particles.filter((p) => p.life <= 0);
    for (const p of dead) p.sprite.destroy();
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  _drawAimLine() {
    const g = this.aimGraphics;
    g.clear();
    if (!this.grid) return;
    const bounds = { left: this.boardLeft, right: this.boardRight, top: this.topY };
    const path = predictBouncePath(this.shooterX, this.shooterY, this.aimer.angle, bounds, this.grid, this.cellSize / 2);
    for (let i = 0; i < path.length; i += 3) {
      const p = path[i];
      g.circle(p.x, p.y, 2.5).fill({ color: 0xffffff, alpha: 0.35 });
    }
  }

  _drawKillLine() {
    const g = this.killLineGraphics;
    g.clear();
    if (!this.width) return;
    const danger = this.state === 'playing' && this._isNearKillLine();
    const alpha = danger ? 0.45 + Math.sin(performance.now() / 140) * 0.25 : 0.22;
    g.moveTo(0, this.killLineY).lineTo(this.width, this.killLineY)
      .stroke({ width: 2, color: 0xff5d73, alpha: Math.max(0, Math.min(1, alpha)) });
  }

  // ---------- teardown ----------

  destroy() {
    this.destroyed = true;
    if (this._resizeObserver) this._resizeObserver.disconnect();
    if (this._cleanupInput) this._cleanupInput();
    if (this.app) this.app.destroy(true, { children: true, texture: true });
  }
}
