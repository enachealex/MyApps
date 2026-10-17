/* Zombie navigation: what Unity's NavMesh and obstacle carving do, for a
   street.

   A grid of 0.5 m cells covers the road around the survivor (it slides
   along as you walk). Every standing prop blocks the cells under it, and
   rubble marks cells as rough (slow, and costlier to path through). From
   that, a flow field gives every cell its walking distance to the
   survivor, so each zombie only has to step to its lowest neighbour.

   The grid is rebuilt whenever a prop breaks, falls over, gets shoved by a
   blast or the street streams in more road (World sets `dirty`), and the
   flow field whenever the survivor changes cell. Zombies therefore re-route
   around (or over) whatever the fighting leaves behind.                   */

import { WALK_HALF } from './world.js';

export const CELL = 0.5;
const AHEAD = 60;          // metres of grid up the road from the survivor
const BEHIND = 26;         // and behind
const INFLATE = 0.32;      // how much props grow by, so zombie bodies clear them
const ROUGH_COST = 3;      // rubble costs this much more to walk through
const REBUILD_EVERY = 0.15;
const SQRT2 = Math.SQRT2;

export class NavGrid {
  constructor() {
    this.x0 = -WALK_HALF;
    this.cols = Math.ceil((WALK_HALF * 2) / CELL);
    this.rows = Math.ceil((AHEAD + BEHIND) / CELL);
    this.n = this.cols * this.rows;
    this.blocked = new Uint8Array(this.n);
    this.rough = new Uint8Array(this.n);
    this.dist = new Float32Array(this.n).fill(Infinity);
    // Binary heap with lazy deletion: (key, cell) pairs.
    this.hKey = new Float32Array(this.n * 8);
    this.hVal = new Int32Array(this.n * 8);
    this.z0 = 0;            // z of the grid's first row (furthest up the road)
    this.goal = -1;
    this.dirty = true;
    this.timer = 0;
    this.builds = 0;        // how many times the grid was rebuilt (for tests)
  }

  reset(pz) {
    this.z0 = pz - AHEAD;
    this.goal = -1;
    this.dirty = true;
  }

  cellOf(x, z) {
    const c = Math.floor((x - this.x0) / CELL);
    const r = Math.floor((z - this.z0) / CELL);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  cx(i) { return this.x0 + ((i % this.cols) + 0.5) * CELL; }
  cz(i) { return this.z0 + (Math.floor(i / this.cols) + 0.5) * CELL; }

  update(dt, px, pz, props, rough) {
    this.timer -= dt;
    // Slide the window along with the survivor.
    const centre = this.z0 + AHEAD;
    if (Math.abs(pz - centre) > 6) { this.z0 = pz - AHEAD; this.dirty = true; }
    const goal = this.cellOf(px, pz);
    if ((goal === this.goal && !this.dirty) || this.timer > 0) return;
    this.timer = REBUILD_EVERY;
    if (this.dirty) { this.rasterize(props, rough); this.dirty = false; this.builds++; }
    this.goal = goal;
    this.flow(goal);
  }

  /* Mark every cell under a standing prop as blocked, and under rubble as rough. */
  rasterize(props, rough) {
    this.blocked.fill(0);
    this.rough.fill(0);
    const mark = (o, arr, pad) => {
      const ex = Math.abs(o.cos) * o.hw + Math.abs(o.sin) * o.hd + pad;
      const ez = Math.abs(o.sin) * o.hw + Math.abs(o.cos) * o.hd + pad;
      const c0 = Math.max(0, Math.floor((o.x - ex - this.x0) / CELL));
      const c1 = Math.min(this.cols - 1, Math.floor((o.x + ex - this.x0) / CELL));
      const r0 = Math.max(0, Math.floor((o.z - ez - this.z0) / CELL));
      const r1 = Math.min(this.rows - 1, Math.floor((o.z + ez - this.z0) / CELL));
      for (let r = r0; r <= r1; r++) {
        const z = this.z0 + (r + 0.5) * CELL - o.z;
        for (let c = c0; c <= c1; c++) {
          const x = this.x0 + (c + 0.5) * CELL - o.x;
          const lx = x * o.cos - z * o.sin, lz = x * o.sin + z * o.cos;
          if (Math.abs(lx) <= o.hw + pad && Math.abs(lz) <= o.hd + pad) arr[r * this.cols + c] = 1;
        }
      }
    };
    for (const p of props) if (p.blocking && !p.destroyed) mark(p, this.blocked, INFLATE);
    for (const r of rough) mark(r, this.rough, 0);
  }

  /* Dijkstra outward from the survivor's cell over 8 neighbours, never
     cutting a blocked corner. */
  flow(goal) {
    const { dist, blocked, rough, cols, rows, hKey, hVal } = this;
    dist.fill(Infinity);
    if (goal < 0) return;
    if (blocked[goal]) {
      // Standing hard against a prop: start from the nearest open cell.
      goal = this.nearestOpen(goal);
      if (goal < 0) return;
    }
    let size = 0;
    const push = (k, v) => {
      let i = size++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (hKey[p] <= k) break;
        hKey[i] = hKey[p]; hVal[i] = hVal[p]; i = p;
      }
      hKey[i] = k; hVal[i] = v;
    };
    const pop = () => {
      const v = hVal[0];
      const k = hKey[--size], vv = hVal[size];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= size) break;
        if (c + 1 < size && hKey[c + 1] < hKey[c]) c++;
        if (hKey[c] >= k) break;
        hKey[i] = hKey[c]; hVal[i] = hVal[c]; i = c;
      }
      hKey[i] = k; hVal[i] = vv;
      return v;
    };
    dist[goal] = 0;
    push(0, goal);
    while (size > 0) {
      const d0 = hKey[0];
      const i = pop();
      if (d0 > dist[i]) continue;
      const r = (i / cols) | 0, c = i - r * cols;
      for (let dr = -1; dr <= 1; dr++) {
        const nr = r + dr;
        if (nr < 0 || nr >= rows) continue;
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nc = c + dc;
          if (nc < 0 || nc >= cols) continue;
          const j = nr * cols + nc;
          if (blocked[j]) continue;
          if (dr && dc && (blocked[r * cols + nc] || blocked[nr * cols + c])) continue;
          const step = (dr && dc ? SQRT2 : 1) * (rough[j] ? ROUGH_COST : 1);
          const nd = d0 + step;
          if (nd < dist[j]) {
            dist[j] = nd;
            if (size < hKey.length) push(nd, j);
          }
        }
      }
    }
  }

  nearestOpen(i) {
    const r0 = (i / this.cols) | 0, c0 = i % this.cols;
    for (let rad = 1; rad <= 4; rad++) {
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          const r = r0 + dr, c = c0 + dc;
          if (r < 0 || c < 0 || r >= this.rows || c >= this.cols) continue;
          const j = r * this.cols + c;
          if (!this.blocked[j]) return j;
        }
      }
    }
    return -1;
  }

  /* Which way should something at (x, z) walk to reach the survivor?
     Returns { x, z } (unit length) or null when there's no known path. */
  steer(x, z, out) {
    let i = this.cellOf(x, z);
    if (i < 0) return null;
    const { dist, blocked, cols, rows } = this;
    const r = (i / cols) | 0, c = i - r * cols;
    let best = blocked[i] ? Infinity : dist[i], bi = -1;
    // Look two rings out when wedged inside a prop's padding.
    const reach = blocked[i] ? 2 : 1;
    for (let dr = -reach; dr <= reach; dr++) {
      const nr = r + dr;
      if (nr < 0 || nr >= rows) continue;
      for (let dc = -reach; dc <= reach; dc++) {
        const nc = c + dc;
        if ((!dr && !dc) || nc < 0 || nc >= cols) continue;
        const j = nr * cols + nc;
        if (blocked[j] || dist[j] >= best) continue;
        if (reach === 1 && dr && dc && (blocked[r * cols + nc] || blocked[nr * cols + c])) continue;
        best = dist[j]; bi = j;
      }
    }
    if (bi < 0) return null;
    const dx = this.cx(bi) - x, dz = this.cz(bi) - z;
    const l = Math.hypot(dx, dz) || 1;
    out.x = dx / l; out.z = dz / l;
    return out;
  }

  isRough(x, z) {
    const i = this.cellOf(x, z);
    return i >= 0 && this.rough[i] === 1;
  }

  reachable(x, z) {
    const i = this.cellOf(x, z);
    return i >= 0 && this.dist[i] < Infinity;
  }

  /* True when nothing blocks the straight line between two points. */
  clear(x0, z0, x1, z1) {
    const d = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.ceil(d / (CELL * 0.5));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const i = this.cellOf(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
      if (i >= 0 && this.blocked[i]) return false;
    }
    return true;
  }
}
