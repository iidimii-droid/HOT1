'use strict';
// Geometry, line of sight and A* pathfinding over a coarse grid.

const CELL = 25;

function dist(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); }

// Does segment (x1,y1)-(x2,y2) cross the rectangle r?
function segRect(x1, y1, x2, y2, r) {
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - r.x, r.x + r.w - x1, y1 - r.y, r.y + r.h - y1];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return false; continue; }
    const t = q[i] / p[i];
    if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}

function circleRectPush(x, y, rad, r) {
  // Returns the corrected position if the circle overlaps the rect, else null.
  const cx = Math.max(r.x, Math.min(x, r.x + r.w));
  const cy = Math.max(r.y, Math.min(y, r.y + r.h));
  const dx = x - cx, dy = y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rad * rad) return null;
  if (d2 > 1e-6) {
    const d = Math.sqrt(d2);
    return { x: cx + (dx / d) * rad, y: cy + (dy / d) * rad };
  }
  // Centre is inside the rect: push out through the nearest edge.
  const opts = [
    { x: r.x - rad, y, d: x - r.x }, { x: r.x + r.w + rad, y, d: r.x + r.w - x },
    { x, y: r.y - rad, d: y - r.y }, { x, y: r.y + r.h + rad, d: r.y + r.h - y },
  ];
  opts.sort((a, b) => a.d - b.d);
  return { x: opts[0].x, y: opts[0].y };
}

class Grid {
  constructor(map, inflate) {
    this.cols = Math.ceil(map.w / CELL);
    this.rows = Math.ceil(map.h / CELL);
    this.blocked = new Uint8Array(this.cols * this.rows);
    const solids = [...map.buildings, ...map.walls, ...(map.blocks || [])];
    this.solids = solids;
    this.inflate = inflate;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = c * CELL, y = r * CELL;
        for (const s of solids) {
          if (x + CELL > s.x - inflate && x < s.x + s.w + inflate &&
              y + CELL > s.y - inflate && y < s.y + s.h + inflate) {
            this.blocked[r * this.cols + c] = 1; break;
          }
        }
      }
    }
  }
  cellOf(x, y) {
    const c = Math.max(0, Math.min(this.cols - 1, Math.floor(x / CELL)));
    const r = Math.max(0, Math.min(this.rows - 1, Math.floor(y / CELL)));
    return r * this.cols + c;
  }
  center(i) { return { x: (i % this.cols) * CELL + CELL / 2, y: Math.floor(i / this.cols) * CELL + CELL / 2 }; }
  isBlockedAt(x, y) { return this.blocked[this.cellOf(x, y)] === 1; }
  // Exact check: does a circle of radius r at (x, y) clear every obstacle?
  pointFree(x, y, r) { return this.solids.every(s => !circleRectPush(x, y, r, s)); }

  nearestOpen(i) {
    if (!this.blocked[i]) return i;
    const seen = new Uint8Array(this.blocked.length);
    const q = [i]; seen[i] = 1;
    for (let h = 0; h < q.length; h++) {
      const cur = q[h];
      if (!this.blocked[cur]) return cur;
      const c = cur % this.cols, r = Math.floor(cur / this.cols);
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
        const n = nr * this.cols + nc;
        if (!seen[n]) { seen[n] = 1; q.push(n); }
      }
    }
    return i;
  }

  // Straight walk between two points without touching blocked cells?
  clearLine(x1, y1, x2, y2) {
    const d = dist(x1, y1, x2, y2);
    const steps = Math.ceil(d / (CELL / 3));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (this.isBlockedAt(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)) return false;
    }
    return true;
  }

  // A* from (sx,sy) to (tx,ty). Returns a smoothed list of waypoints, ending at
  // the target (or the nearest reachable open cell to it).
  findPath(sx, sy, tx, ty) {
    let start = this.nearestOpen(this.cellOf(sx, sy));
    let goal = this.nearestOpen(this.cellOf(tx, ty));
    // A blocked cell can still hold a clear spot (e.g. right behind sandbags).
    const exact = goal === this.cellOf(tx, ty) || this.pointFree(tx, ty, this.inflate - 3);
    const goalPt = exact ? { x: tx, y: ty } : this.center(goal);
    if (this.clearLine(sx, sy, goalPt.x, goalPt.y)) return [goalPt];

    const n = this.blocked.length, cols = this.cols;
    const g = new Float32Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap = new Heap();
    const gc = goal % cols, gr = Math.floor(goal / cols);
    const h = i => { const dc = Math.abs(i % cols - gc), dr = Math.abs(Math.floor(i / cols) - gr); return (dc + dr) + (Math.SQRT2 - 2) * Math.min(dc, dr); };
    g[start] = 0; heap.push(start, h(start));
    let found = false;
    while (heap.size) {
      const cur = heap.pop();
      if (cur === goal) { found = true; break; }
      if (closed[cur]) continue;
      closed[cur] = 1;
      const c = cur % cols, r = Math.floor(cur / cols);
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= this.rows) continue;
        const ni = nr * cols + nc;
        if (this.blocked[ni] || closed[ni]) continue;
        if (dr && dc && (this.blocked[r * cols + nc] || this.blocked[nr * cols + c])) continue; // no corner cutting
        const ng = g[cur] + (dr && dc ? Math.SQRT2 : 1);
        if (ng < g[ni]) { g[ni] = ng; came[ni] = cur; heap.push(ni, ng + h(ni)); }
      }
    }
    if (!found) return [goalPt];
    const cells = [];
    for (let i = goal; i !== -1 && i !== start; i = came[i]) cells.push(i);
    cells.reverse();
    const pts = cells.map(i => this.center(i));
    pts[pts.length - 1] = goalPt;
    // String-pulling: skip waypoints that are directly visible.
    const out = [];
    let ax = sx, ay = sy, k = 0;
    while (k < pts.length) {
      let far = k;
      for (let j = pts.length - 1; j > k; j--) {
        if (this.clearLine(ax, ay, pts[j].x, pts[j].y)) { far = j; break; }
      }
      out.push(pts[far]); ax = pts[far].x; ay = pts[far].y; k = far + 1;
    }
    return out;
  }
}

class Heap {
  constructor() { this.items = []; this.pri = []; }
  get size() { return this.items.length; }
  push(item, p) {
    const it = this.items, pr = this.pri;
    let i = it.length; it.push(item); pr.push(p);
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (pr[par] <= p) break;
      it[i] = it[par]; pr[i] = pr[par]; i = par;
    }
    it[i] = item; pr[i] = p;
  }
  pop() {
    const it = this.items, pr = this.pri;
    const top = it[0];
    const lastI = it.pop(), lastP = pr.pop();
    if (it.length) {
      let i = 0; const n = it.length;
      for (;;) {
        let l = 2 * i + 1, r = l + 1, m = i, mp = lastP;
        if (l < n && pr[l] < mp) { m = l; mp = pr[l]; }
        if (r < n && pr[r] < mp) { m = r; }
        if (m === i) break;
        it[i] = it[m]; pr[i] = pr[m]; i = m;
      }
      it[i] = lastI; pr[i] = lastP;
    }
    return top;
  }
}

module.exports = { CELL, dist, segRect, circleRectPush, Grid };
