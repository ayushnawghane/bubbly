// Aiming input + projectile physics for the bubble cannon.

const MIN_ANGLE = -75 * (Math.PI / 180); // radians from straight up
const MAX_ANGLE = 75 * (Math.PI / 180);
const PROJECTILE_SPEED = 900; // px/sec

export class Aimer {
  constructor() {
    this.angle = 0; // 0 = straight up, negative = left, positive = right
  }

  clamp() {
    this.angle = Math.min(MAX_ANGLE, Math.max(MIN_ANGLE, this.angle));
  }

  aimAt(originX, originY, targetX, targetY) {
    const dx = targetX - originX;
    const dy = originY - targetY; // invert so "up" is positive
    this.angle = Math.atan2(dx, Math.max(dy, 1));
    this.clamp();
  }

  nudge(deltaRadians) {
    this.angle += deltaRadians;
    this.clamp();
  }

  direction() {
    return { dx: Math.sin(this.angle), dy: -Math.cos(this.angle) };
  }
}

export class Projectile {
  constructor(x, y, angle, color, type, radius) {
    const dx = Math.sin(angle);
    const dy = -Math.cos(angle);
    this.x = x;
    this.y = y;
    this.vx = dx * PROJECTILE_SPEED;
    this.vy = dy * PROJECTILE_SPEED;
    this.color = color;
    this.type = type;
    this.radius = radius;
  }

  /** Move the projectile, bouncing off the left/right walls. Returns true if it hit the top wall. */
  advance(dt, bounds) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    if (this.x - this.radius < bounds.left) {
      this.x = bounds.left + this.radius;
      this.vx *= -1;
    } else if (this.x + this.radius > bounds.right) {
      this.x = bounds.right - this.radius;
      this.vx *= -1;
    }

    return this.y - this.radius <= bounds.top;
  }
}

/**
 * Check a point (with the given collision radius) against every currently
 * occupied grid cell near its row (only a small vertical window is scanned
 * for performance). Returns the [r, c] of the bubble it collided with, or null.
 */
export function findGridCollisionAt(grid, x, y, radius) {
  const approxRow = Math.floor((y - grid.topY) / grid.rowHeight);
  const collideDist = radius + grid.cellSize / 2;

  for (let r = Math.max(0, approxRow - 2); r <= approxRow + 2; r++) {
    if (r >= grid.rows.length) continue;
    const cols = grid.colsInRow(r);
    for (let c = 0; c < cols; c++) {
      const cell = grid.get(r, c);
      if (!cell) continue;
      const center = grid.cellCenter(r, c);
      const dx = center.x - x;
      const dy = center.y - y;
      if (dx * dx + dy * dy <= collideDist * collideDist) {
        return [r, c];
      }
    }
  }
  return null;
}

export function findGridCollision(grid, projectile) {
  return findGridCollisionAt(grid, projectile.x, projectile.y, projectile.radius);
}

/**
 * Simulate the shot's path (with wall bounces) for the aim-preview line.
 * Returns a polyline (array of {x,y} points) from the origin to wherever
 * it would first hit the grid/top wall, or until it runs out of bounces/length.
 */
export function predictBouncePath(originX, originY, angle, bounds, grid, radius, opts = {}) {
  const { maxBounces = 3, maxLength = 1400, step = 8 } = opts;
  let x = originX;
  let y = originY;
  let dx = Math.sin(angle);
  let dy = -Math.cos(angle);
  const points = [{ x, y }];
  let traveled = 0;
  let bounces = 0;

  while (traveled < maxLength && bounces <= maxBounces) {
    x += dx * step;
    y += dy * step;
    traveled += step;

    if (x - radius < bounds.left) {
      x = bounds.left + radius;
      dx *= -1;
      bounces += 1;
    } else if (x + radius > bounds.right) {
      x = bounds.right - radius;
      dx *= -1;
      bounces += 1;
    }

    points.push({ x, y });

    if (y - radius <= bounds.top) break;
    if (findGridCollisionAt(grid, x, y, radius)) break;
  }

  return points;
}
