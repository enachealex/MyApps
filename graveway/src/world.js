/* The street: one endless road running away from the camera (-z), built in
   32 m chunks just beyond the fog and torn down once they're behind you.
   Each chunk is seeded by its index, so the same run seed always lays out
   the same road.

   Chunks hold scenery (road, buildings, lamps, litter), pickups, and props:
   wrecked cars, barricades, explosive barrels and brick walls. Props live in
   `world.props`; what happens when they're shot, blown up or shoved is in
   props.js. Whenever the set of standing props changes, `world.navDirty`
   is raised and the navigation grid rebuilds. */

import * as THREE from '../vendor/three.module.min.js';
import { PROPS, SET_PIECES, POWERUPS, POWERUP_DROPS, pickPowerup } from './config.js';
import {
  TEX, lambert, boxGeo, mergeGeos, glowDecal, makeCar, makeBarrier, makeLamp, makeFireBarrel,
  makeHealthPack, makeArmorVest, makeExplosiveBarrel, makeWall, makeTanker, makeCondemned, makePowerup,
} from './models.js';

export const ROAD_HALF = 6;          // asphalt from -6 to 6
export const WALK_HALF = 7.4;        // how far sideways anyone can go (the sidewalk edge)
export const START_PZ = 2;           // where the survivor stands at 0 m
export const FACADE_X = WALK_HALF + 0.6;   // where the building fronts are
const CHUNK = 32;                    // metres; a multiple of the road texture's 16 m tile
const EDGE = 14;                     // z where chunk 0 starts (behind the start barricade)
const BUILD_AHEAD = 78;              // keep road built this far past the survivor
const KEEP_BEHIND = 40;              // and this far behind

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Box UVs scaled to the box's real size, so one facade texture tiles the
   same on a short shop and a tall tower. */
function facadeGeo(w, h, d, tile = 8) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // BoxGeometry faces, 4 vertices each: +x, -x, +y, -y, +z, -z
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile);
    }
  }
  return g;
}

let MATS = null;
function mats() {
  if (MATS) return MATS;
  const tints = [0x9a8f86, 0x7f8790, 0x8e7a6a, 0x6f746c, 0xa39a8a, 0x7a6e74];
  const facades = [];
  for (const t of tints) {
    for (const f of TEX.facades) {
      facades.push(new THREE.MeshLambertMaterial({
        color: t, map: f.map, emissiveMap: f.emissive, emissive: 0xffffff, emissiveIntensity: 0.85,
      }));
    }
  }
  const road = TEX.road.clone();
  road.repeat.set(1, CHUNK / 16);
  road.needsUpdate = true;
  const walk = TEX.sidewalk.clone();
  walk.repeat.set(1, CHUNK / 4);
  walk.needsUpdate = true;
  MATS = {
    facades,
    road: new THREE.MeshLambertMaterial({ map: road }),
    walk: new THREE.MeshLambertMaterial({ map: walk }),
    curb: lambert(0x6a6a6c),
    under: lambert(0x16171a),
    litter: lambert(0x24262a),
  };
  return MATS;
}

let GROUND = null;
function groundGeos() {
  if (GROUND) return GROUND;
  GROUND = {
    road: new THREE.PlaneGeometry(ROAD_HALF * 2, CHUNK).rotateX(-Math.PI / 2),
    walk: mergeGeos([boxGeo(3, 0.16, CHUNK, -(ROAD_HALF + 1.5), 0.08, 0), boxGeo(3, 0.16, CHUNK, ROAD_HALF + 1.5, 0.08, 0)]),
    curb: mergeGeos([boxGeo(0.18, 0.2, CHUNK, -(ROAD_HALF + 0.09), 0.1, 0), boxGeo(0.18, 0.2, CHUNK, ROAD_HALF + 0.09, 0.1, 0)]),
    under: new THREE.PlaneGeometry(80, CHUNK).rotateX(-Math.PI / 2).translate(0, -0.01, 0),
  };
  return GROUND;
}

export class World {
  constructor(scene, seed, startZ) {
    this.scene = scene;
    this.seed = seed;
    this.startZ = startZ;            // where this run's survivor starts
    this.chunks = new Map();
    this.props = [];                 // every prop on the built road
    this.rough = [];                 // rubble footprints (slow ground)
    this.alleys = [];
    this.items = [];
    this.animated = [];
    this.navDirty = true;
    this.onCoins = null;             // (spots) => void, set by the game
    this.lotsOfPowerups = false;     // playtest tool: two power-ups on every chunk
    this.first = Math.max(0, Math.floor((EDGE - (startZ + 30)) / CHUNK));
  }

  update(pz, t) {
    const last = Math.floor((EDGE - (pz - BUILD_AHEAD)) / CHUNK);
    for (let i = this.first; i <= last; i++) if (!this.chunks.has(i)) this.build(i);
    for (const [i, ch] of this.chunks) {
      if (ch.z1 > pz + KEEP_BEHIND) this.drop(i);
    }
    // Never rebuild what was torn down behind you.
    this.first = Math.max(this.first, Math.floor((EDGE - (pz + KEEP_BEHIND)) / CHUNK));
    this.animate(t);
  }

  addRough(r) {
    this.rough.push(r);
    this.navDirty = true;
  }

  /* Things spawned mid-run (rubble, scorch marks) go with the chunk they
     landed in, so they're cleaned up along with it. */
  addToChunk(z, obj, own = []) {
    const i = this.chunkAt(z);
    const ch = this.chunks.get(i);
    if (!ch) { for (const d of own) d.dispose(); return -1; }
    ch.group.add(obj);
    ch.own.push(...own);
    return i;
  }

  chunkAt(z) { return Math.floor((EDGE - z) / CHUNK); }

  dispose() {
    for (const i of [...this.chunks.keys()]) this.drop(i);
  }

  drop(i) {
    const ch = this.chunks.get(i);
    this.chunks.delete(i);
    this.scene.remove(ch.group);
    for (const d of ch.own) d.dispose();
    for (const p of this.props) if (p.chunk === i) p.removed = true;   // stops their smoke and fire
    this.props = this.props.filter((p) => p.chunk !== i);
    this.rough = this.rough.filter((r) => r.chunk !== i);
    this.items = this.items.filter((it) => it.chunk !== i);
    this.alleys = this.alleys.filter((a) => a.chunk !== i);
    this.animated = this.animated.filter((a) => a.chunk !== i);
    this.navDirty = true;
  }

  build(i) {
    const rng = mulberry32((this.seed * 7919 + i * 104729) >>> 0);
    const rand = (a, b) => a + rng() * (b - a);
    const z0 = EDGE - i * CHUNK, z1 = z0 - CHUNK, zc = (z0 + z1) / 2;
    const group = new THREE.Group();
    const own = [];
    const ch = { i, z0, z1, group, own };
    this.chunks.set(i, ch);
    this.scene.add(group);
    const M = mats(), G = groundGeos();

    /* Ground: four shared meshes per chunk. */
    for (const [geo, mat] of [[G.road, M.road], [G.walk, M.walk], [G.curb, M.curb], [G.under, M.under]]) {
      const m = new THREE.Mesh(geo, mat);
      m.position.z = zc;
      group.add(m);
    }

    /* Buildings, with the odd alley for ambushes, and now and then a
       condemned building you can bring down across the road. */
    const condemned = i % SET_PIECES.condemnedEvery === SET_PIECES.condemnedEvery - 2 && z0 < this.startZ - 40;
    const condemnedSide = rng() < 0.5 ? -1 : 1;
    for (const s of [-1, 1]) {
      let z = z0;
      let setPiece = condemned && s === condemnedSide;
      while (z > z1 + 0.5) {
        if (setPiece && z - z1 > 11) {
          setPiece = false;
          const w = 9, h = 13;
          const cb = makeCondemned(w, h);
          this.addProp('condemned', cb, s * (FACADE_X + 0.6), z - 1 - w / 2, s > 0 ? Math.PI : 0, i, group, own);
          // What's left standing behind it once it falls.
          const back = new THREE.Mesh(facadeGeo(7, 9, w + 2), M.facades[Math.floor(rng() * M.facades.length)]);
          own.push(back.geometry);
          back.position.set(s * (FACADE_X + 2 + 3.5), 4.5, z - 1 - w / 2);
          group.add(back);
          z -= w + 2;
          continue;
        }
        const len = Math.min(rand(6, 13), z - z1);
        if (rng() < 0.15 && len > 4 && z < this.startZ - 8) {
          const w = 3.2;
          this.alleys.push({ x: s * (WALK_HALF + 1.6), z: z - w / 2, side: s, chunk: i });
          const back = new THREE.Mesh(facadeGeo(1, 14, w + 2), M.facades[Math.floor(rng() * M.facades.length)]);
          own.push(back.geometry);
          back.position.set(s * (WALK_HALF + 9), 7, z - w / 2);
          group.add(back);
          z -= w;
          continue;
        }
        const h = rand(6, 24), d = rand(7, 11);
        const b = new THREE.Mesh(facadeGeo(d, h, len), M.facades[Math.floor(rng() * M.facades.length)]);
        own.push(b.geometry);
        b.position.set(s * (WALK_HALF + 0.6 + d / 2), h / 2, z - len / 2);
        group.add(b);
        if (rng() < 0.3) {
          const aw = new THREE.Mesh(boxGeo(1.2, 0.12, len * 0.7), lambert([0x6a2a2a, 0x2a4a5a, 0x4a5a2a][Math.floor(rng() * 3)]));
          own.push(aw.geometry);
          aw.position.set(s * (WALK_HALF + 0.05), 3, z - len / 2);
          aw.rotation.z = s * 0.25;
          group.add(aw);
        }
        z -= len;
      }
    }

    /* Lamps, every 16 m, alternating sides. They stop bullets and can be
       knocked down. */
    for (let k = 0; k < 2; k++) {
      const s = (i + k) % 2 ? 1 : -1;
      const lamp = makeLamp();
      const p = this.addProp('lamp', lamp, s * (ROAD_HALF + 0.6), z0 - 6 - k * 16, s > 0 ? -Math.PI / 2 : Math.PI / 2, i, group, own);
      p.light = lamp;
      if (rng() < 0.22) this.animated.push({ kind: 'flicker', head: lamp.head, pool: lamp.pool, seed: rng() * 100, chunk: i, prop: p });
    }

    /* Litter: one merged mesh for every bag and box in the chunk. */
    const litter = [];
    for (let k = 0; k < CHUNK / 3; k++) {
      const s = rng() < 0.5 ? -1 : 1;
      const lx = rng() < 0.7 ? s * rand(ROAD_HALF + 0.4, WALK_HALF) : rand(-ROAD_HALF, ROAD_HALF);
      const sz = rand(0.25, 0.6);
      litter.push(boxGeo(sz, sz * rand(0.4, 0.9), sz * rand(0.8, 1.4), lx, sz * 0.3, rand(z1, z0)));
    }
    const lm = new THREE.Mesh(mergeGeos(litter), M.litter);
    own.push(lm.geometry);
    group.add(lm);

    /* The barricade behind the start: there's no going back. */
    const backZ = this.startZ + 5.4;
    if (backZ <= z0 && backZ > z1) {
      for (let x = -6; x <= 6; x += 2.4) {
        const bar = makeBarrier();
        bar.group.position.set(x, 0, backZ);
        bar.group.rotation.y = rand(-0.08, 0.08);
        group.add(bar.group);
      }
      const bus = makeCar(rng);
      bus.group.position.set(rand(-3, 3), 0, backZ + 3);
      bus.group.rotation.y = Math.PI / 2 + rand(-0.2, 0.2);
      bus.group.scale.set(1.2, 1.2, 1.4);
      group.add(bus.group);
    }

    /* Props. Nothing in the first stretch after the start, and every row
       leaves a gap of at least 2.5 m so the road is never sealed off. */
    const clearUntil = this.startZ - 14;
    let z = z0 - rand(2, 8);
    while (z > z1 + 2) {
      if (z < clearUntil) this.placeRow(rng, rand, z, i, group, own);
      z -= rand(9, 15);
    }

    /* Coins and pickups. */
    const spots = [];
    for (let cz = z0 - rand(2, 10); cz > z1; cz -= rand(14, 22)) {
      if (cz > this.startZ - 6) continue;
      const x = rand(-5, 5), n = 4 + Math.floor(rng() * 4);
      const curve = rng() < 0.4 ? rand(-0.5, 0.5) : 0;
      for (let k = 0; k < n; k++) {
        const px = THREE.MathUtils.clamp(x + curve * k, -6.5, 6.5), pz = cz - k * 1.3;
        if (pz > z1 && !this.blocked(px, pz, 0.4)) spots.push({ x: px, z: pz });
      }
    }
    if (this.onCoins && spots.length) this.onCoins(spots);
    if (z0 < this.startZ - 30) {
      if (rng() < 0.4) this.placeItem(rng, rand, 'health', rand(z1 + 2, z0 - 2), i, group, own);
      if (rng() < 0.25) this.placeItem(rng, rand, 'armor', rand(z1 + 2, z0 - 2), i, group, own);
    }
    const lots = this.lotsOfPowerups;
    if (z0 < this.startZ - (lots ? 10 : POWERUP_DROPS.from)) {
      const n = lots ? 2 : rng() < POWERUP_DROPS.perChunk ? 1 : 0;
      for (let k = 0; k < n; k++) this.placeItem(rng, rand, 'power', rand(z1 + 2, z0 - 2), i, group, own, pickPowerup(rng()));
    }
    this.navDirty = true;
  }

  blocked(x, z, pad) {
    return this.props.some((c) => !c.destroyed && Math.abs(c.x - x) < c.r + pad && Math.abs(c.z - z) < c.r + pad);
  }

  /* Puts a prop on the street: its model in the chunk, its collider in
     world.props. Also used mid-run for slabs left by a collapse. */
  addProp(kind, model, x, z, rot, chunk, group = this.chunks.get(chunk)?.group, own = this.chunks.get(chunk)?.own) {
    if (!group) { for (const d of model.own || []) d.dispose(); return null; }
    model.group.position.set(x, 0, z);
    model.group.rotation.y = rot;
    group.add(model.group);
    const def = PROPS[kind];
    const p = {
      kind, def, chunk, x, z, y: 0, rot, hw: model.hw, hd: model.hd, height: model.height,
      cos: Math.cos(rot), sin: Math.sin(rot), r: Math.hypot(model.hw, model.hd),
      hp: def.hp, maxHp: def.hp, blocking: true, destroyed: false,
      group: model.group, meshes: model.meshes, model, flash: 0,
      vx: 0, vy: 0, vz: 0, va: 0, moving: false, airborne: false,
    };
    if (model.own) own.push(...model.own);
    this.props.push(p);
    this.navDirty = true;
    return p;
  }

  /* Where a bullet's path meets a building front (outside an alley), as a
     distance along it, or Infinity. */
  facadeT(x, z, dx, dz, len) {
    if (Math.abs(dx) < 1e-6) return Infinity;
    const side = dx > 0 ? 1 : -1;
    const t = (side * FACADE_X - x) / dx;
    if (t < 0 || t > len) return Infinity;
    const zc = z + dz * t;
    for (const a of this.alleys) if (a.side === side && Math.abs(zc - a.z) < 1.5) return Infinity;
    return t;
  }

  /* One row of trouble across the road at z. */
  placeRow(rng, rand, z, chunk, group, own) {
    const r = rng();
    const add = (kind, model, x, zz, rot) => this.addProp(kind, model, x, zz, rot, chunk, group, own);

    if (z < this.startZ - SET_PIECES.tankerFrom && rng() < SET_PIECES.tankerChance) {
      // A fuel tanker, mostly along the road. Give it a wide berth.
      const x = (rng() < 0.5 ? -1 : 1) * rand(2.4, 4.4);
      add('tanker', makeTanker(rng), x, z, rand(-0.2, 0.2) + (rng() < 0.5 ? Math.PI : 0));
      return;
    }

    if (r < 0.36) {
      // A wreck or two, with the odd explosive barrel tucked beside it.
      const x = rng() < 0.5 ? rand(-ROAD_HALF + 1.2, -1.4) : rand(1.4, ROAD_HALF - 1.2);
      const rot = rng() < 0.3 ? rand(0.6, 1.4) * (rng() < 0.5 ? -1 : 1) : rand(-0.35, 0.35);
      add('car', makeCar(rng), x, z, rot);
      if (rng() < 0.45) add('barrel', makeExplosiveBarrel(), x + rand(-1.4, 1.4), z + (rng() < 0.5 ? -2.6 : 2.6), 0);
      if (rng() < 0.25) add('car', makeCar(rng), -Math.sign(x) * rand(3.9, 5), z - rand(-1.5, 1.5), rand(-0.3, 0.3));
    } else if (r < 0.6) {
      // Barricades: a short line, or a chokepoint across most of the road.
      const choke = rng() < 0.35;
      const n = choke ? 4 : 1 + Math.floor(rng() * 2);
      const gapAt = Math.floor(rng() * (n + 1));
      let x = choke ? -ROAD_HALF + 1.2 : rand(-4, 4 - n * 2.4);
      const rot = choke ? 0 : rand(-0.25, 0.25);
      for (let k = 0; k < n; k++) {
        if (choke && k === gapAt) x += 2.8;            // the way through
        add('barricade', makeBarrier(), x, z, rot);
        x += 2.45;
      }
    } else if (r < 0.75) {
      // A cluster of explosive barrels.
      const x = rand(-5, 5);
      const n = 2 + Math.floor(rng() * 3);
      for (let k = 0; k < n; k++) add('barrel', makeExplosiveBarrel(), x + rand(-1, 1), z + rand(-1, 1), 0);
    } else if (r < 0.92) {
      // A weak brick wall across part of the road.
      const w = rand(3.5, 6.5);
      const x = rng() < 0.5 ? -WALK_HALF + w / 2 : WALK_HALF - w / 2;
      add('wall', makeWall(w), x, z, 0);
    } else {
      const fb = makeFireBarrel();
      const p = add('fire', fb, rand(-5, 5), z, 0);
      this.animated.push({ kind: 'fire', flames: fb.flames, pool: fb.pool, seed: rng() * 100, chunk, prop: p });
      own.push(fb.flames[0].material, fb.flames[0].geometry, fb.flames[1].geometry, fb.pool.material);
    }
  }

  placeItem(rng, rand, kind, z, chunk, group, own, power) {
    for (let tries = 0; tries < 8; tries++) {
      const x = rand(-5.5, 5.5);
      if (this.blocked(x, z, 0.8)) continue;
      this.items.push(this.makeItem(kind, x, z, chunk, group, own, power));
      return;
    }
  }

  /* kind is 'health', 'armor' or 'power'; power is the POWERUPS id. */
  makeItem(kind, x, z, chunk, group, own, power = null) {
    let obj, decal;
    if (kind === 'power') {
      obj = makePowerup(power);
      decal = glowDecal(POWERUPS[power].color, 2.4, 0.55, { map: TEX.ring });
    } else {
      obj = kind === 'health' ? makeHealthPack() : makeArmorVest();
      decal = glowDecal(kind === 'health' ? 0x4dff6a : 0x4aa8ff, 2.2, 0.5);
      obj.traverse((o) => { if (o.isMesh) own.push(o.geometry); });
    }
    obj.position.set(x, 0, z);
    decal.position.set(x, 0.04, z);
    group.add(obj, decal);
    return { kind, power, obj, decal, x, z, taken: false, chunk };
  }

  /* Drops a pickup where a zombie fell. */
  dropItem(kind, x, z, power = null) {
    const i = this.chunkAt(z);
    const ch = this.chunks.get(i);
    if (!ch) return;
    this.items.push(this.makeItem(kind, x, z, i, ch.group, ch.own, power));
  }

  animate(t) {
    for (const a of this.animated) {
      if (a.prop && a.prop.destroyed) continue;      // knocked over: no more flicker or flames
      if (a.kind === 'fire') {
        const f = 0.85 + Math.sin(t * 17 + a.seed) * 0.08 + Math.sin(t * 29 + a.seed * 2) * 0.07;
        a.flames[0].scale.set(f, 1 / f, 1);
        a.flames[1].scale.set(1 / f, f, 1);
        a.pool.material.opacity = 0.38 + (f - 0.85) * 1.2;
      } else if (a.kind === 'flicker') {
        const on = Math.sin(t * 13 + a.seed) + Math.sin(t * 7.3 + a.seed * 3) > -0.6;
        a.head.visible = on;
        a.pool.visible = on;
      }
    }
  }
}

/* Pushes a circle out of every standing prop it overlaps. Props are rotated
   boxes, so the circle is moved into each box's own frame, clamped, and moved
   back. Returns the last prop it was pushed out of (or null). */
export function resolveColliders(props, p, radius) {
  let hit = null;
  for (const c of props) {
    if (!c.blocking || c.destroyed) continue;
    const dx = p.x - c.x, dz = p.z - c.z;
    if (Math.abs(dx) > c.r + radius || Math.abs(dz) > c.r + radius) continue;
    const lx = dx * c.cos - dz * c.sin;
    const lz = dx * c.sin + dz * c.cos;
    const cx = Math.max(-c.hw, Math.min(c.hw, lx));
    const cz = Math.max(-c.hd, Math.min(c.hd, lz));
    const ox = lx - cx, oz = lz - cz;
    const d2 = ox * ox + oz * oz;
    if (d2 >= radius * radius) continue;
    let nx, nz;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      const push = radius - d;
      nx = lx + (ox / d) * push;
      nz = lz + (oz / d) * push;
    } else {
      // centre is inside the box: leave by the nearest face
      const px = c.hw - Math.abs(lx), pz = c.hd - Math.abs(lz);
      if (px < pz) { nx = Math.sign(lx || 1) * (c.hw + radius); nz = lz; }
      else { nx = lx; nz = Math.sign(lz || 1) * (c.hd + radius); }
    }
    p.x = c.x + nx * c.cos + nz * c.sin;
    p.z = c.z - nx * c.sin + nz * c.cos;
    hit = c;
  }
  return hit;
}

/* The first standing, bullet-stopping prop a segment runs into: its
   distance along the segment (Infinity if none) and the prop. A slab test
   in each box's own frame. */
export function rayProps(props, x, z, dx, dz, len) {
  let best = Infinity, which = null;
  for (const c of props) {
    if (c.destroyed || !c.def.blocksBullets) continue;
    const ox = x - c.x, oz = z - c.z;
    if (Math.abs(ox) > c.r + len + 1 || Math.abs(oz) > c.r + len + 1) continue;
    const lx = ox * c.cos - oz * c.sin, lz = ox * c.sin + oz * c.cos;
    const ldx = dx * c.cos - dz * c.sin, ldz = dx * c.sin + dz * c.cos;
    let t0 = 0, t1 = len, miss = false;
    for (const [o, d, h] of [[lx, ldx, c.hw], [lz, ldz, c.hd]]) {
      if (Math.abs(d) < 1e-9) { if (Math.abs(o) > h) { miss = true; break; } continue; }
      let a = (-h - o) / d, b = (h - o) / d;
      if (a > b) { const tmp = a; a = b; b = tmp; }
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      if (t0 > t1) { miss = true; break; }
    }
    if (!miss && t0 < best) { best = t0; which = c; }
  }
  return { t: best, prop: which };
}
