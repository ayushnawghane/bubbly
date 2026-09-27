// Flood-fill match detection and floating-bubble ("orphan") clean-up for a HexGrid.

const MIN_MATCH = 3;

// Two adjacent bubbles are "linked" (belong to the same poppable chain) if
// either one is a rainbow wildcard, or they share the same color. This is a
// pairwise relation evaluated at each edge of the walk, so a rainbow bubble
// bridges its neighbors correctly no matter where it sits in the chain.
function linked(a, b) {
  return a.type === 'rainbow' || b.type === 'rainbow' || a.color === b.color;
}

function sameColorGroup(grid, startR, startC) {
  const start = grid.get(startR, startC);
  if (!start) return [];
  const visited = new Set([`${startR},${startC}`]);
  const stack = [[startR, startC, start]];
  const group = [[startR, startC]];

  while (stack.length) {
    const [r, c, cell] = stack.pop();
    for (const [nr, nc] of grid.neighbors(r, c)) {
      const key = `${nr},${nc}`;
      if (visited.has(key)) continue;
      const neighborCell = grid.get(nr, nc);
      if (!neighborCell) continue;
      if (!linked(cell, neighborCell)) continue;
      visited.add(key);
      stack.push([nr, nc, neighborCell]);
      group.push([nr, nc]);
    }
  }
  return group;
}

/**
 * Pop the connected same-color group containing (r,c) if it has >= MIN_MATCH bubbles.
 * Returns the list of [r,c] cells that were popped (empty array if no match).
 */
export function popMatchesAt(grid, r, c) {
  const group = sameColorGroup(grid, r, c);
  if (group.length < MIN_MATCH) return [];
  for (const [gr, gc] of group) grid.remove(gr, gc);
  return group;
}

/**
 * Detonate a bomb bubble: pop it plus every bubble within `radiusCells`
 * hex-steps (BFS distance) of it, regardless of color.
 */
export function popBomb(grid, r, c, radiusCells = 1) {
  const visited = new Map([[`${r},${c}`, 0]]);
  const queue = [[r, c, 0]];
  const popped = [];
  while (queue.length) {
    const [cr, cc, dist] = queue.shift();
    if (grid.get(cr, cc)) popped.push([cr, cc]);
    if (dist >= radiusCells) continue;
    for (const [nr, nc] of grid.neighbors(cr, cc)) {
      const key = `${nr},${nc}`;
      if (visited.has(key)) continue;
      visited.set(key, dist + 1);
      queue.push([nr, nc, dist + 1]);
    }
  }
  for (const [pr, pc] of popped) grid.remove(pr, pc);
  return popped;
}

/**
 * Find every bubble not connected (directly or transitively) to row 0,
 * i.e. bubbles left floating after a pop, and remove them.
 * Returns the list of [r,c] cells that were dropped.
 */
export function dropFloatingBubbles(grid) {
  const visited = new Set();
  const queue = [];
  const firstRow = grid.rows[0] || [];
  for (let c = 0; c < firstRow.length; c++) {
    if (firstRow[c]) {
      visited.add(`0,${c}`);
      queue.push([0, c]);
    }
  }
  while (queue.length) {
    const [r, c] = queue.shift();
    for (const [nr, nc] of grid.neighbors(r, c)) {
      const key = `${nr},${nc}`;
      if (visited.has(key)) continue;
      if (!grid.get(nr, nc)) continue;
      visited.add(key);
      queue.push([nr, nc]);
    }
  }

  const dropped = [];
  grid.forEach((_cell, r, c) => {
    if (!visited.has(`${r},${c}`)) dropped.push([r, c]);
  });
  for (const [r, c] of dropped) grid.remove(r, c);
  return dropped;
}
