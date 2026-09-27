import * as THREE from 'three';

// Bubble color palette + bomb/rainbow specials.
export const COLORS = ['#ff5d73', '#4fd6ff', '#ffd76a', '#7bff9e', '#c48bff', '#ff9f4a'];

const SPHERE_SEGMENTS_W = 28;
const SPHERE_SEGMENTS_H = 20;

function makeRainbowTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;
  const segments = COLORS.length;
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, size / 2, a0, a1);
    ctx.closePath();
    ctx.fillStyle = COLORS[i];
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeSoftDotTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

/**
 * Build the shared geometry + per-color material templates used by every
 * bubble in the scene. Grid-placed bubbles clone their material from the
 * template (see GameEngine._createBubbleMesh) so each one can fade out
 * independently when popped/dropped; the shooter's preview/projectile
 * meshes reference these templates directly since they never fade.
 */
export function buildBubbleAssets() {
  const geometry = new THREE.SphereGeometry(1, SPHERE_SEGMENTS_W, SPHERE_SEGMENTS_H);
  const materials = new Map();

  for (const color of COLORS) {
    materials.set(
      color,
      new THREE.MeshPhysicalMaterial({
        color,
        roughness: 0.28,
        metalness: 0.05,
        clearcoat: 0.7,
        clearcoatRoughness: 0.22,
      })
    );
  }

  materials.set(
    'bomb',
    new THREE.MeshStandardMaterial({
      color: 0x241d38,
      roughness: 0.4,
      metalness: 0.25,
      emissive: 0xff5d73,
      emissiveIntensity: 0.55,
    })
  );

  const rainbowTex = makeRainbowTexture();
  materials.set(
    'rainbow',
    new THREE.MeshPhysicalMaterial({
      map: rainbowTex,
      roughness: 0.2,
      metalness: 0,
      clearcoat: 0.8,
      clearcoatRoughness: 0.15,
      emissive: 0xffffff,
      emissiveMap: rainbowTex,
      emissiveIntensity: 0.25,
    })
  );

  const dotTexture = makeSoftDotTexture();

  return { geometry, materials, dotTexture };
}

export function disposeBubbleAssets(assets) {
  assets.geometry.dispose();
  for (const mat of assets.materials.values()) {
    if (mat.map) mat.map.dispose();
    if (mat.emissiveMap) mat.emissiveMap.dispose();
    mat.dispose();
  }
  assets.dotTexture.dispose();
}
