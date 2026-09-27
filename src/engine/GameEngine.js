import * as THREE from 'three';
import { HexGrid } from './grid.js';
import { popMatchesAt, popBomb, dropFloatingBubbles } from './matcher.js';
import { Aimer, Projectile, findGridCollision, predictBouncePath } from './shooter.js';
import { TweenManager, lerp } from './tween.js';
import { buildBubbleAssets, disposeBubbleAssets, COLORS } from './materials.js';
import { Audio } from './audio.js';
import { getHighScore, submitScore, touchDailyStreak } from './storage.js';

const IDEAL_CELL_PX = 46;
const MIN_COLS = 7;
const MAX_COLS = 13;
const DEFAULT_COLS = 9;
const MIN_PREFILL_ROWS = 4;
const MAX_PREFILL_ROWS = 10;
const PREFILL_FILL_RATIO = 0.42;
const INITIAL_COLORS = 4;
const INITIAL_ROW_INTERVAL = 14000;
const MIN_ROW_INTERVAL = 5000;
const ROW_INTERVAL_STEP = 450;
const POWERUP_START_SCORE = 300;
const INITIAL_SHUFFLES = 3;

const CAMERA_FOV = 42;
const TILT_ANGLE = THREE.MathUtils.degToRad(16);
const AIM_DOT_COUNT = 64;

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/**
 * Owns the Three.js renderer/scene and the whole game simulation. React never
 * touches this loop directly — it creates one instance, calls start()/
 * shuffleCurrentBubble()/setMuted() from UI event handlers, and reads
 * game state only through the callbacks below (which the caller wires to
 * the Zustand store). This keeps the 60fps loop entirely inside Three.js's
 * own animation loop, untouched by React's render cycle.
 *
 * Gameplay (grid, matching, shooter physics) is computed entirely in flat
 * 2D pixel coordinates, exactly like the previous 2D renderer — only the
 * final positions get projected into a tilted 3D scene via pixelToWorld().
 * That keeps aiming/collision math simple while the board still renders as
 * lit, shaded 3D spheres viewed from a slightly tilted "arcade" camera.
 */
export class GameEngine {
  constructor(container, callbacks = {}) {
    this.container = container;
    this.callbacks = callbacks; // onScore, onBest, onStreak, onCombo, onShuffles, onGameOver
    this.destroyed = false;
    this.state = 'idle'; // 'idle' | 'playing' | 'gameover'
    this.meshes = new Map(); // "r,c" -> Mesh
    this.tweens = new TweenManager();
    this.particles = [];
    this.audio = new Audio();
    this.aimer = new Aimer();
    this.pointerActive = false;
    this.cols = null;
    this._onKeyDown = this._onKeyDown.bind(this);
  }

  async init() {
    const rect = this.container.getBoundingClientRect();
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    if (this.destroyed) {
      this.renderer.dispose();
      return;
    }

    this.renderer.domElement.style.touchAction = 'none';
    this.container.appendChild(this.renderer.domElement);

    this.fxLayer = document.createElement('div');
    this.fxLayer.className = 'fx-layer';
    this.container.appendChild(this.fxLayer);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x0e0a1c, 400, 1800);

    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, this.width / this.height, 1, 5000);
    this.camera.position.set(0, 0, 600);
    this.camera.lookAt(0, 0, 0);

    const hemi = new THREE.HemisphereLight(0x8fd6ff, 0x140f24, 0.85);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff3e0, 1.35);
    key.castShadow = true;
    const shadowSize = this.width < 480 ? 512 : 1024;
    key.shadow.mapSize.set(shadowSize, shadowSize);
    key.shadow.bias = -0.0015;
    key.shadow.normalBias = 0.025; // bubbles are curved spheres — normalBias avoids acne PCF bias alone can't fix
    this.scene.add(key);
    this.scene.add(key.target);
    this.keyLight = key;

    this.boardGroup = new THREE.Group();
    this.boardGroup.rotation.x = -TILT_ANGLE;
    this.scene.add(this.boardGroup);

    const shadowMat = new THREE.ShadowMaterial({ opacity: 0.32 });
    this.shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), shadowMat);
    this.shadowPlane.position.z = -60;
    this.shadowPlane.receiveShadow = true;
    this.boardGroup.add(this.shadowPlane);

    this.assets = buildBubbleAssets();

    this.currentMesh = new THREE.Mesh(this.assets.geometry, this.assets.materials.get(COLORS[0]));
    this.currentMesh.castShadow = true;
    this.currentMesh.receiveShadow = true;
    this.nextMesh = new THREE.Mesh(this.assets.geometry, this.assets.materials.get(COLORS[0]));
    this.nextMesh.castShadow = true;
    this.boardGroup.add(this.currentMesh, this.nextMesh);

    this.cannonGroup = this._buildCannon();
    this.boardGroup.add(this.cannonGroup);

    // A single Points object for the whole aim-trajectory preview (one draw
    // call for up to AIM_DOT_COUNT dots, instead of one Mesh per dot).
    const aimGeo = new THREE.BufferGeometry();
    this._aimPositions = new Float32Array(AIM_DOT_COUNT * 3);
    aimGeo.setAttribute('position', new THREE.BufferAttribute(this._aimPositions, 3));
    aimGeo.setDrawRange(0, 0);
    const aimMat = new THREE.PointsMaterial({
      color: 0xffffff, size: 6, sizeAttenuation: true, transparent: true, opacity: 0.6, depthWrite: false,
    });
    this._aimPoints = new THREE.Points(aimGeo, aimMat);
    this.boardGroup.add(this._aimPoints);

    const killMat = new THREE.MeshBasicMaterial({ color: 0xff5d73, transparent: true, opacity: 0.25 });
    this.killLineMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 3), killMat);
    this.boardGroup.add(this.killLineMesh);

    this._computeLayout();
    this._bindInput();

    this._resizeObserver = new ResizeObserver(() => this._computeLayout(true));
    this._resizeObserver.observe(this.container);

    this._lastTime = performance.now();
    this.renderer.setAnimationLoop(() => this._frame());
  }

  // ---------- decorative shooter cannon ----------

  _buildCannon() {
    const group = new THREE.Group();
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x2b2540, roughness: 0.5, metalness: 0.3 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.15, 0.5, 20), baseMat);
    base.rotation.x = Math.PI / 2;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);

    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x4a3f6b, roughness: 0.35, metalness: 0.4 });
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 1.6, 16), barrelMat);
    barrel.position.y = 0.7;
    barrel.castShadow = true;
    group.add(barrel);

    group.scale.setScalar(22);
    return group;
  }

  // ---------- coordinate bridge (2D pixel-space game <-> tilted 3D scene) ----------

  pixelToWorld(x, y, z = 0) {
    return new THREE.Vector3(x - this.width / 2, this.height / 2 - y, z);
  }

  _bubbleZJitter(r, c) {
    const h = Math.sin(r * 12.9898 + c * 78.233) * 43758.5453;
    return (h - Math.floor(h) - 0.5) * 8;
  }

  _worldToScreen(worldPos) {
    const v = worldPos.clone().project(this.camera);
    return {
      x: (v.x * 0.5 + 0.5) * this.width,
      y: (-v.y * 0.5 + 0.5) * this.height,
    };
  }

  // ---------- layout ----------

  _computeBoardShape() {
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    this.cols = clamp(Math.round(w / IDEAL_CELL_PX), MIN_COLS, MAX_COLS);
  }

  _computePrefillRows() {
    const rowHeight = this.cellSize * 0.87;
    const playHeight = Math.max(0, this.killLineY - this.topY);
    const rows = Math.round((playHeight * PREFILL_FILL_RATIO) / rowHeight);
    return clamp(rows, MIN_PREFILL_ROWS, MAX_PREFILL_ROWS);
  }

  _computeLayout(relayout = false) {
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    this.width = w;
    this.height = h;

    const cols = this.cols || DEFAULT_COLS;
    this.cellSize = w / cols;
    this.boardLeft = 0;
    this.boardRight = w;
    this.topY = Math.max(64, h * 0.11);
    this.killLineY = h - Math.max(92, h * 0.15);
    this.shooterX = w / 2;
    this.shooterY = h - Math.max(54, h * 0.09);

    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    const dist = h / 2 / Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV) / 2);
    this.camera.position.z = dist;
    this.camera.near = Math.max(1, dist * 0.05);
    this.camera.far = dist * 4;
    this.camera.updateProjectionMatrix();

    if (this.scene?.fog) {
      this.scene.fog.near = dist * 0.55;
      this.scene.fog.far = dist * 2.4;
    }

    if (this.keyLight) {
      this.keyLight.position.set(w * 0.1, h * 0.28, dist * 1.15);
      this.keyLight.target.position.set(0, -h * 0.05, 0);
      this.keyLight.target.updateMatrixWorld();
      const frustum = Math.max(w, h) * 0.75;
      this.keyLight.shadow.camera.left = -frustum;
      this.keyLight.shadow.camera.right = frustum;
      this.keyLight.shadow.camera.top = frustum;
      this.keyLight.shadow.camera.bottom = -frustum;
      this.keyLight.shadow.camera.near = dist * 0.2;
      this.keyLight.shadow.camera.far = dist * 3.2;
      this.keyLight.shadow.camera.updateProjectionMatrix();
    }

    if (this.grid) {
      this.grid.cellSize = this.cellSize;
      this.grid.rowHeight = this.cellSize * 0.87;
      this.grid.boardLeft = this.boardLeft;
      this.grid.topY = this.topY;
      if (relayout) this._relayoutMeshes();
    }

    this._layoutShooterMeshes();
  }

  _relayoutMeshes() {
    const radius = (this.cellSize - 3) / 2;
    for (const [key, mesh] of this.meshes) {
      const [r, c] = key.split(',').map(Number);
      const { x, y } = this.grid.cellCenter(r, c);
      const p = this.pixelToWorld(x, y, mesh.position.z);
      mesh.position.x = p.x;
      mesh.position.y = p.y;
      mesh.scale.setScalar(radius);
    }
  }

  _layoutShooterMeshes() {
    if (!this.currentMesh) return;
    const radius = (this.cellSize - 3) / 2;
    const p = this.pixelToWorld(this.shooterX, this.shooterY, 6);
    this.currentMesh.position.copy(p);
    this.currentMesh.scale.setScalar(radius);

    const nextRadius = this.cellSize * 0.33;
    const p2 = this.pixelToWorld(this.shooterX + this.cellSize * 1.4, this.shooterY, 6);
    this.nextMesh.position.copy(p2);
    this.nextMesh.scale.setScalar(nextRadius);

    if (this.cannonGroup) {
      const cp = this.pixelToWorld(this.shooterX, this.shooterY, 2);
      this.cannonGroup.position.copy(cp);
    }
  }

  // ---------- input ----------

  _bindInput() {
    const canvas = this.renderer.domElement;

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
    else if (e.key === ' ') {
      e.preventDefault();
      this.shoot();
    }
  }

  // ---------- lifecycle ----------

  start() {
    this._computeBoardShape();
    this._computeLayout();

    this.grid = new HexGrid(this.cols, this.cellSize, this.boardLeft, this.topY);
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

    for (const mesh of this.meshes.values()) {
      this.boardGroup.remove(mesh);
      mesh.material.dispose();
    }
    this.meshes.clear();
    if (this.projectileMesh) {
      this.boardGroup.remove(this.projectileMesh);
      this.projectileMesh = null;
    }
    this.tweens = new TweenManager();
    for (const p of this.particles) {
      this.boardGroup.remove(p.sprite);
      p.sprite.material.dispose();
    }
    this.particles = [];
    this.boardGroup.position.set(0, 0, 0);

    const prefillRows = this._computePrefillRows();
    for (let r = 0; r < prefillRows; r++) {
      const cols = this.grid.colsInRow(r);
      const row = [];
      for (let c = 0; c < cols; c++) {
        const cell = { color: this._randomColor() };
        row.push(cell);
        this._createBubbleMesh(r, c, cell);
      }
      this.grid.rows[r] = row;
    }

    this.currentBubble = this._spawnBubble();
    this.nextBubble = this._spawnBubble();
    this._updateShooterMeshes();
    this._layoutShooterMeshes();

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
    const key = this.currentBubble.type || this.currentBubble.color;
    this.projectileMesh = new THREE.Mesh(this.assets.geometry, this.assets.materials.get(key));
    this.projectileMesh.castShadow = true;
    const radius = (this.cellSize - 3) / 2;
    this.projectileMesh.scale.setScalar(radius);
    const p = this.pixelToWorld(this.projectile.x, this.projectile.y, 6);
    this.projectileMesh.position.copy(p);
    this.boardGroup.add(this.projectileMesh);
    this.audio.shoot();

    this.currentBubble = this.nextBubble;
    this.nextBubble = this._spawnBubble();
    this._updateShooterMeshes();
  }

  shuffleCurrentBubble() {
    if (this.state !== 'playing' || this.shuffles <= 0) return;
    const palette = this._boardColors().filter((c) => c !== this.currentBubble.color);
    const pool = palette.length ? palette : this._boardColors();
    this.currentBubble = { color: pool[Math.floor(Math.random() * pool.length)] };
    this.shuffles -= 1;
    this._updateShooterMeshes();
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

  _updateShooterMeshes() {
    const radius = (this.cellSize - 3) / 2;
    this.currentMesh.material = this.assets.materials.get(this.currentBubble.type || this.currentBubble.color);
    this.currentMesh.scale.setScalar(radius);
    const nextRadius = this.cellSize * 0.33;
    this.nextMesh.material = this.assets.materials.get(this.nextBubble.type || this.nextBubble.color);
    this.nextMesh.scale.setScalar(nextRadius);
  }

  // ---------- mesh <-> grid sync ----------

  _createBubbleMesh(r, c, cell) {
    const key = cell.type || cell.color;
    const baseMat = this.assets.materials.get(key);
    const material = baseMat.clone();
    material.transparent = true;
    const mesh = new THREE.Mesh(this.assets.geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const radius = (this.cellSize - 3) / 2;
    mesh.scale.setScalar(radius);
    const { x, y } = this.grid.cellCenter(r, c);
    const p = this.pixelToWorld(x, y, this._bubbleZJitter(r, c));
    mesh.position.copy(p);
    mesh.userData.color = cell.color;
    this.boardGroup.add(mesh);
    this.meshes.set(`${r},${c}`, mesh);
    return mesh;
  }

  _popMeshAt(r, c) {
    const key = `${r},${c}`;
    const mesh = this.meshes.get(key);
    if (!mesh) return;
    this.meshes.delete(key);
    this._burstParticles(mesh.position.clone(), mesh.userData.color || '#ffffff', 8);
    const startScale = mesh.scale.x;
    this.tweens.add({
      duration: 0.16,
      onUpdate: (t) => {
        mesh.scale.setScalar(lerp(startScale, startScale * 1.5, t));
        mesh.material.opacity = 1 - t;
      },
      onComplete: () => {
        this.boardGroup.remove(mesh);
        mesh.material.dispose();
      },
    });
  }

  _dropMeshAt(r, c) {
    const key = `${r},${c}`;
    const mesh = this.meshes.get(key);
    if (!mesh) return;
    this.meshes.delete(key);
    this._burstParticles(mesh.position.clone(), mesh.userData.color || '#ffd76a', 5);
    const startY = mesh.position.y;
    this.tweens.add({
      duration: 0.35,
      easing: (t) => t,
      onUpdate: (t) => {
        mesh.position.y = startY - t * t * 260;
        mesh.material.opacity = 1 - t;
      },
      onComplete: () => {
        this.boardGroup.remove(mesh);
        mesh.material.dispose();
      },
    });
  }

  // ---------- effects ----------

  _burstParticles(localPos, colorHex, count = 8) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 220;
      const material = new THREE.SpriteMaterial({
        map: this.assets.dotTexture,
        color: colorHex,
        transparent: true,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(material);
      const size = 6 + Math.random() * 7;
      sprite.scale.set(size, size, 1);
      sprite.position.copy(localPos);
      this.boardGroup.add(sprite);
      this.particles.push({
        sprite,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        vz: (Math.random() - 0.5) * 140,
        life: 1,
        decay: 1.6 + Math.random() * 1.2,
      });
    }
  }

  _spawnComboText(worldPos, points, combo) {
    const label = combo > 1 ? `+${points}  x${combo}` : `+${points}`;
    const screen = this._worldToScreen(worldPos);
    const el = document.createElement('div');
    el.className = 'fx-combo-text';
    el.textContent = label;
    el.style.left = `${screen.x}px`;
    el.style.top = `${screen.y}px`;
    this.fxLayer.appendChild(el);
    requestAnimationFrame(() => {
      el.style.transform = 'translate(-50%, -50%) translateY(-40px)';
      el.style.opacity = '0';
    });
    setTimeout(() => el.remove(), 650);
  }

  _shake() {
    const group = this.boardGroup;
    const baseRotX = -TILT_ANGLE;
    this.tweens.add({
      duration: 0.18,
      easing: (t) => t,
      onUpdate: (t) => {
        const decay = 1 - t;
        group.position.x = (Math.random() - 0.5) * 10 * decay;
        group.position.y = (Math.random() - 0.5) * 10 * decay;
      },
      onComplete: () => {
        group.position.set(0, 0, 0);
        group.rotation.x = baseRotX;
      },
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
    for (let c = 0; c < this.cols; c++) rowData.push({ color: this._randomColor() });

    const oldMeshes = this.meshes;
    this.meshes = new Map();
    for (const [key, mesh] of oldMeshes) {
      const [r, c] = key.split(',').map(Number);
      this.meshes.set(`${r + 1},${c}`, mesh);
      const fromY = mesh.position.y;
      const toY = fromY - this.grid.rowHeight;
      this.tweens.add({ duration: 0.2, onUpdate: (t) => { mesh.position.y = lerp(fromY, toY, t); } });
    }

    this.grid.unshiftRow(rowData);

    const targetRadius = (this.cellSize - 3) / 2;
    for (let c = 0; c < this.cols; c++) {
      const mesh = this._createBubbleMesh(0, c, rowData[c]);
      const finalY = mesh.position.y;
      const startY = finalY + this.grid.rowHeight;
      mesh.position.y = startY;
      mesh.material.opacity = 0;
      mesh.scale.setScalar(targetRadius * 0.6);
      this.tweens.add({
        duration: 0.2,
        onUpdate: (t) => {
          mesh.position.y = lerp(startY, finalY, t);
          mesh.material.opacity = t;
          mesh.scale.setScalar(lerp(targetRadius * 0.6, targetRadius, t));
        },
      });
    }

    this.rowInterval = Math.max(MIN_ROW_INTERVAL, this.rowInterval - ROW_INTERVAL_STEP);
  }

  // ---------- landing / matching ----------

  _land() {
    const proj = this.projectile;
    this.projectile = null;
    if (this.projectileMesh) {
      this.boardGroup.remove(this.projectileMesh);
      this.projectileMesh = null;
    }

    const [r, c] = this.grid.nearestEmptyCell(proj.x, Math.max(proj.y, this.topY + this.cellSize / 2));
    const placed = { color: proj.color, type: proj.type };
    this.grid.set(r, c, placed);
    const mesh = this._createBubbleMesh(r, c, placed);

    const target = mesh.position.clone();
    const startP = this.pixelToWorld(proj.x, proj.y, mesh.position.z);
    mesh.position.copy(startP);
    this.tweens.add({
      duration: 0.09,
      onUpdate: (t) => { mesh.position.lerpVectors(startP, target, t); },
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

      for (const [pr, pc] of popped) this._popMeshAt(pr, pc);

      mesh.position.copy(target);
      const worldPos = new THREE.Vector3();
      mesh.getWorldPosition(worldPos);
      mesh.position.copy(startP);
      this._spawnComboText(worldPos, gained, this.combo);

      const floating = dropFloatingBubbles(this.grid);
      if (floating.length) {
        this.bubblesPopped += floating.length;
        this.score += floating.length * 20;
        for (const [fr, fc] of floating) this._dropMeshAt(fr, fc);
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

  _frame() {
    const now = performance.now();
    const rawDt = (now - this._lastTime) / 1000;
    this._lastTime = now;
    // Clamp dt so a frame hiccup (tab throttling, a heavy GC pause, slow
    // device) can't let the projectile tunnel through the grid in one step —
    // the collision check only scans a small row window around its position.
    const dt = Math.min(rawDt, 0.032);

    this.tweens.update(dt);
    this._updateParticles(dt);
    this._updateKillLine();
    this._spinBubbles(dt);

    if (this.state === 'playing') {
      this.timeSinceLastRow += dt * 1000;
      if (this.timeSinceLastRow >= this.rowInterval) {
        this.timeSinceLastRow = 0;
        this._pushNewRow();
        this._checkGameOver();
      }

      if (this.projectile) {
        const bounds = { left: this.boardLeft, right: this.boardRight, top: this.topY };
        const hitTop = this.projectile.advance(dt, bounds);
        if (this.projectileMesh) {
          this.projectileMesh.position.set(
            this.projectile.x - this.width / 2,
            this.height / 2 - this.projectile.y,
            6
          );
        }
        const hit = hitTop || !!findGridCollision(this.grid, this.projectile);
        if (hit) this._land();
      }

      if (this.cannonGroup) this.cannonGroup.rotation.z = -this.aimer.angle;
      this._updateAimDots();
    }

    this.renderer.render(this.scene, this.camera);
  }

  _spinBubbles(dt) {
    for (const mesh of this.meshes.values()) {
      mesh.rotation.y += dt * 0.15;
      mesh.rotation.x += dt * 0.05;
    }
  }

  _updateParticles(dt) {
    for (const p of this.particles) {
      p.vy -= 420 * dt;
      p.sprite.position.x += p.vx * dt;
      p.sprite.position.y += p.vy * dt;
      p.sprite.position.z += p.vz * dt;
      p.life -= p.decay * dt;
      p.sprite.material.opacity = Math.max(p.life, 0);
    }
    const dead = this.particles.filter((p) => p.life <= 0);
    for (const p of dead) {
      this.boardGroup.remove(p.sprite);
      p.sprite.material.dispose();
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  _updateAimDots() {
    if (!this.grid) {
      this._aimPoints.geometry.setDrawRange(0, 0);
      return;
    }
    const bounds = { left: this.boardLeft, right: this.boardRight, top: this.topY };
    const path = predictBouncePath(this.shooterX, this.shooterY, this.aimer.angle, bounds, this.grid, this.cellSize / 2);
    const halfW = this.width / 2;
    const halfH = this.height / 2;
    let count = 0;
    for (let i = 0; i < path.length && count < AIM_DOT_COUNT; i += 3) {
      const point = path[i];
      const base = count * 3;
      this._aimPositions[base] = point.x - halfW;
      this._aimPositions[base + 1] = halfH - point.y;
      this._aimPositions[base + 2] = 3;
      count++;
    }
    this._aimPoints.geometry.attributes.position.needsUpdate = true;
    this._aimPoints.geometry.setDrawRange(0, count);
  }

  _updateKillLine() {
    if (!this.width || !this.killLineMesh) return;
    const danger = this.state === 'playing' && this._isNearKillLine();
    const alpha = danger ? 0.45 + Math.sin(performance.now() / 140) * 0.25 : 0.22;
    this.killLineMesh.material.opacity = Math.max(0, Math.min(1, alpha));
    this.killLineMesh.scale.set(this.width, 1, 1);
    this.killLineMesh.position.set(0, this.height / 2 - this.killLineY, 5);
  }

  // ---------- teardown ----------

  destroy() {
    this.destroyed = true;
    if (this._resizeObserver) this._resizeObserver.disconnect();
    if (this._cleanupInput) this._cleanupInput();

    if (this.renderer) {
      this.renderer.setAnimationLoop(null);

      for (const mesh of this.meshes.values()) mesh.material.dispose();
      for (const p of this.particles) p.sprite.material.dispose();
      if (this._aimPoints) {
        this._aimPoints.geometry.dispose();
        this._aimPoints.material.dispose();
      }
      if (this.killLineMesh) {
        this.killLineMesh.geometry.dispose();
        this.killLineMesh.material.dispose();
      }
      if (this.shadowPlane) {
        this.shadowPlane.geometry.dispose();
        this.shadowPlane.material.dispose();
      }
      if (this.cannonGroup) {
        this.cannonGroup.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) obj.material.dispose();
        });
      }
      if (this.assets) disposeBubbleAssets(this.assets);

      this.renderer.dispose();
      if (this.renderer.domElement.parentNode) {
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      }
    }

    if (this.fxLayer && this.fxLayer.parentNode) this.fxLayer.parentNode.removeChild(this.fxLayer);
  }
}
