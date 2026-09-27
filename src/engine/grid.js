// Staggered hex grid (odd-row offset, "pointy" honeycomb packing).
// Even rows have COLS columns; odd rows have COLS-1 columns, inset by half
// a cell so bubbles nestle between the row above/below.

export class HexGrid {
  constructor(cols, cellSize, boardLeft, topY) {
    this.cols = cols;
    this.cellSize = cellSize;
    this.rowHeight = cellSize * 0.87;
    this.boardLeft = boardLeft;
    this.topY = topY;
    /** @type {Array<Array<{color:string, type:string}|null>>} */
    this.rows = [];
  }

  colsInRow(r) {
    return r % 2 === 0 ? this.cols : this.cols - 1;
  }

  rowXOffset(r) {
    return r % 2 === 0 ? 0 : this.cellSize / 2;
  }

  cellCenter(r, c) {
    const x = this.boardLeft + c * this.cellSize + this.cellSize / 2 + this.rowXOffset(r);
    const y = this.topY + r * this.rowHeight + this.cellSize / 2;
    return { x, y };
  }

  ensureRow(r) {
    while (this.rows.length <= r) this.rows.push(new Array(this.colsInRow(this.rows.length)).fill(null));
  }

  get(r, c) {
    if (r < 0 || r >= this.rows.length) return null;
    const row = this.rows[r];
    if (c < 0 || c >= row.length) return null;
    return row[c];
  }

  set(r, c, value) {
    this.ensureRow(r);
    this.rows[r][c] = value;
  }

  remove(r, c) {
    if (this.rows[r]) this.rows[r][c] = null;
  }

  neighbors(r, c) {
    const isOffsetRow = r % 2 === 1;
    const deltas = isOffsetRow
      ? [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, 1]]
      : [[0, -1], [0, 1], [-1, -1], [-1, 0], [1, -1], [1, 0]];
    const out = [];
    for (const [dr, dc] of deltas) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nc < 0) continue;
      if (nr < this.rows.length && nc >= this.colsInRow(nr)) continue;
      out.push([nr, nc]);
    }
    return out;
  }

  // Push a freshly generated row in at the top; everything else shifts
  // down by one row index (closer to the kill line) automatically.
  unshiftRow(row) {
    this.rows.unshift(row);
  }

  isEmpty(r, c) {
    return this.get(r, c) === null;
  }

  forEach(fn) {
    for (let r = 0; r < this.rows.length; r++) {
      const row = this.rows[r];
      for (let c = 0; c < row.length; c++) {
        if (row[c]) fn(row[c], r, c);
      }
    }
  }

  // Convert a landing pixel position into the nearest empty valid cell.
  nearestEmptyCell(x, y) {
    let bestRow = Math.round((y - this.topY - this.cellSize / 2) / this.rowHeight);
    bestRow = Math.max(0, bestRow);
    this.ensureRow(bestRow);

    const colFor = (r) => {
      const cols = this.colsInRow(r);
      let c = Math.round((x - this.boardLeft - this.cellSize / 2 - this.rowXOffset(r)) / this.cellSize);
      return Math.min(Math.max(c, 0), cols - 1);
    };

    const candidates = [];
    for (const r of [bestRow, bestRow - 1, bestRow + 1]) {
      if (r < 0) continue;
      this.ensureRow(r);
      const c = colFor(r);
      for (const cc of [c - 1, c, c + 1]) {
        if (cc < 0 || cc >= this.colsInRow(r)) continue;
        candidates.push([r, cc]);
      }
    }

    let best = null;
    let bestDist = Infinity;
    for (const [r, c] of candidates) {
      if (!this.isEmpty(r, c)) continue;
      const center = this.cellCenter(r, c);
      const dist = (center.x - x) ** 2 + (center.y - y) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        best = [r, c];
      }
    }

    if (best) return best;

    // Fallback: every nearby cell was occupied (rare, dense board) —
    // widen the search outward row by row until an empty cell is found.
    for (let r = 0; r < this.rows.length + 2; r++) {
      this.ensureRow(r);
      const cols = this.colsInRow(r);
      for (let c = 0; c < cols; c++) {
        if (this.isEmpty(r, c)) return [r, c];
      }
    }
    return [this.rows.length, 0];
  }
}
