/* Builds one level: a long city street running away from the camera (-z),
   lined with buildings and lamps, littered with wrecks, with a safe zone at
   the far end. The layout is seeded by the level number, so a level looks
   the same every time you play it. */

import * as THREE from '../vendor/three.module.min.js';
import {
  TEX, lambert, boxGeo, mergeGeos, glowDecal, makeCar, makeBarrier, makeLamp, makeFireBarrel,
  makeHealthPack, makeArmorVest,
} from './models.js';

export const ROAD_HALF = 6;          // asphalt from -6 to 6
export const WALK_HALF = 7.4;        // how far sideways anyone can go (the sidewalk edge)
export const START_Z = 6;            // the barricade behind you

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

let FACADE_MATS = null;
function facadeMats() {
  if (FACADE_MATS) return FACADE_MATS;
  const tints = [0x9a8f86, 0x7f8790, 0x8e7a6a, 0x6f746c, 0xa39a8a, 0x7a6e74];
  FACADE_MATS = [];
  for (const t of tints) {
    for (const f of TEX.facades) {
      FACADE_MATS.push(new THREE.MeshLambertMaterial({
        color: t, map: f.map, emissiveMap: f.emissive, emissive: 0xffffff, emissiveIntensity: 0.85,
      }));
    }
  }
  return FACADE_MATS;
}

export function buildLevel(scene, level, spec) {
  const rng = mulberry32(level * 9973 + 17);
  const rand = (a, b) => a + rng() * (b - a);
  const L = spec.length;
  const group = new THREE.Group();
  scene.add(group);
  const disposables = [];
  const own = (x) => { disposables.push(x); return x; };
  const colliders = [];
  const animated = [];           // things that flicker or pulse
  const alleys = [];             // ambush spawn points
  const zFar = -L - 26, zNear = START_Z + 18;
  const span = zNear - zFar;

  const addCollider = (x, z, hw, hd, rot) => {
    colliders.push({ x, z, hw, hd, cos: Math.cos(rot), sin: Math.sin(rot), r: Math.hypot(hw, hd) });
  };
  const blocked = (x, z, pad) => colliders.some((c) => Math.abs(c.x - x) < c.r + pad && Math.abs(c.z - z) < c.r + pad);

  /* Ground ------------------------------------------------------------- */
  const roadTex = own(TEX.road.clone());
  roadTex.repeat.set(1, span / 16);
  roadTex.needsUpdate = true;
  const road = new THREE.Mesh(own(new THREE.PlaneGeometry(ROAD_HALF * 2, span).rotateX(-Math.PI / 2)), own(new THREE.MeshLambertMaterial({ map: roadTex })));
  road.position.z = (zNear + zFar) / 2;
  group.add(road);

  const walkTex = own(TEX.sidewalk.clone());
  walkTex.repeat.set(1, span / 3);
  walkTex.needsUpdate = true;
  const walkMat = own(new THREE.MeshLambertMaterial({ map: walkTex }));
  const curbMat = lambert(0x6a6a6c);
  for (const s of [-1, 1]) {
    const walk = new THREE.Mesh(own(boxGeo(3, 0.16, span)), walkMat);
    walk.position.set(s * (ROAD_HALF + 1.5), 0.08, (zNear + zFar) / 2);
    group.add(walk);
    const curb = new THREE.Mesh(own(boxGeo(0.18, 0.2, span)), curbMat);
    curb.position.set(s * (ROAD_HALF + 0.09), 0.1, (zNear + zFar) / 2);
    group.add(curb);
  }
  // Everything beyond the buildings: dark ground so alleys don't show sky.
  const under = new THREE.Mesh(own(new THREE.PlaneGeometry(80, span).rotateX(-Math.PI / 2)), lambert(0x16171a));
  under.position.set(0, -0.01, (zNear + zFar) / 2);
  group.add(under);

  /* Buildings ------------------------------------------------------------ */
  const mats = facadeMats();
  for (const s of [-1, 1]) {
    let z = zNear;
    while (z > zFar) {
      const len = rand(6, 13);
      const alley = z < -14 && z > -L + 10 && rng() < 0.16;
      if (alley) {
        const w = 3.2;
        alleys.push({ x: s * (WALK_HALF + 1.6), z: z - w / 2, side: s });
        // a back wall closes the alley off in the dark
        const back = new THREE.Mesh(own(facadeGeo(1, 14, w + 2)), mats[Math.floor(rng() * mats.length)]);
        back.position.set(s * (WALK_HALF + 9), 7, z - w / 2);
        group.add(back);
        z -= w;
        continue;
      }
      const h = rand(6, 24);
      const d = rand(7, 11);
      const b = new THREE.Mesh(own(facadeGeo(d, h, len)), mats[Math.floor(rng() * mats.length)]);
      b.position.set(s * (WALK_HALF + 0.6 + d / 2), h / 2, z - len / 2);
      group.add(b);
      // awnings and ledges break up the silhouette
      if (rng() < 0.35) {
        const aw = new THREE.Mesh(own(boxGeo(1.2, 0.12, len * 0.7)), lambert([0x6a2a2a, 0x2a4a5a, 0x4a5a2a][Math.floor(rng() * 3)]));
        aw.position.set(s * (WALK_HALF + 0.05), 3, z - len / 2);
        aw.rotation.z = s * 0.25;
        group.add(aw);
      }
      z -= len;
    }
  }

  /* Start barricade: you can't go back the way you came ------------------- */
  for (let x = -6; x <= 6; x += 2.4) {
    const bar = makeBarrier();
    bar.group.position.set(x, 0, START_Z + 1.4);
    bar.group.rotation.y = rand(-0.08, 0.08);
    group.add(bar.group);
  }
  const bus = makeCar(rng);
  bus.group.position.set(rand(-3, 3), 0, START_Z + 4.5);
  bus.group.rotation.y = Math.PI / 2 + rand(-0.2, 0.2);
  bus.group.scale.set(1.2, 1.2, 1.4);
  group.add(bus.group);

  /* Lamps -------------------------------------------------------------- */
  let side = 1;
  for (let z = START_Z - 4; z > -L - 10; z -= 17) {
    const lamp = makeLamp();
    lamp.group.position.set(side * (ROAD_HALF + 0.6), 0, z);
    lamp.group.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    group.add(lamp.group);
    if (rng() < 0.22) animated.push({ kind: 'flicker', head: lamp.head, pool: lamp.pool, seed: rng() * 100 });
    side = -side;
  }

  /* Wrecks: cars, barriers and burning barrels ------------------------- */
  let z = -14;
  while (z > -L + 12) {
    const r = rng();
    if (r < 0.58) {
      const car = makeCar(rng);
      const rot = rng() < 0.3 ? rand(0.6, 1.4) * (rng() < 0.5 ? -1 : 1) : rand(-0.35, 0.35);
      const x = rng() < 0.5 ? rand(-ROAD_HALF + 1.2, -1.2) : rand(1.2, ROAD_HALF - 1.2);
      car.group.position.set(x, 0, z);
      car.group.rotation.y = rot;
      group.add(car.group);
      addCollider(x, z, car.hw, car.hd, rot);
      // sometimes a second wreck on the other side, leaving a gap through the middle
      if (rng() < 0.3) {
        const car2 = makeCar(rng);
        const x2 = -Math.sign(x) * rand(3.8, 5);
        const rot2 = rand(-0.3, 0.3);
        car2.group.position.set(x2, 0, z - rand(-1.5, 1.5));
        car2.group.rotation.y = rot2;
        group.add(car2.group);
        addCollider(x2, car2.group.position.z, car2.hw, car2.hd, rot2);
      }
    } else if (r < 0.85) {
      const n = 1 + Math.floor(rng() * 2);
      const x0 = rand(-4, 4 - n * 2.4);
      const rot = rand(-0.25, 0.25);
      for (let i = 0; i < n; i++) {
        const bar = makeBarrier();
        const bx = x0 + i * 2.45;
        bar.group.position.set(bx, 0, z);
        bar.group.rotation.y = rot;
        group.add(bar.group);
        addCollider(bx, z, bar.hw, bar.hd, rot);
      }
    } else {
      const fb = makeFireBarrel();
      const x = rand(-5, 5);
      fb.group.position.set(x, 0, z);
      group.add(fb.group);
      addCollider(x, z, fb.hw, fb.hd, 0);
      animated.push({ kind: 'fire', flames: fb.flames, pool: fb.pool, seed: rng() * 100 });
      disposables.push(fb.flames[0].material, fb.flames[0].geometry, fb.flames[1].geometry, fb.pool.material);
    }
    z -= rand(9, 16);
  }

  /* Litter: one merged mesh for every bag and box on the street ------- */
  const litter = [];
  for (let i = 0; i < L / 3; i++) {
    const s = rng() < 0.5 ? -1 : 1;
    const lx = rng() < 0.7 ? s * rand(ROAD_HALF + 0.4, WALK_HALF) : rand(-ROAD_HALF, ROAD_HALF);
    const lz = rand(-L, START_Z);
    const sz = rand(0.25, 0.6);
    litter.push(boxGeo(sz, sz * rand(0.4, 0.9), sz * rand(0.8, 1.4), lx, sz * 0.3, lz));
  }
  if (litter.length) group.add(new THREE.Mesh(own(mergeGeos(litter)), lambert(0x24262a)));

  /* Safe zone -------------------------------------------------------- */
  const goalZ = -L;
  const ring = glowDecal(0x5dff7a, 7, 0.9, { own: true, map: TEX.ring });
  ring.position.set(0, 0.05, goalZ);
  group.add(ring);
  disposables.push(ring.material);
  const beam = new THREE.Mesh(own(new THREE.CylinderGeometry(0.5, 1.4, 28, 16, 1, true).translate(0, 14, 0)), own(new THREE.MeshBasicMaterial({
    color: 0x6dff8a, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  })));
  beam.position.set(0, 0, goalZ);
  group.add(beam);
  animated.push({ kind: 'goal', ring, beam });

  for (let x = -6; x <= 6; x += 2.4) {
    const bar = makeBarrier();
    bar.group.position.set(x, 0, goalZ - 5);
    group.add(bar.group);
  }
  const sandMat = lambert(0x8a7a5a);
  for (const s of [-1, 1]) {
    const bags = new THREE.Mesh(own(mergeGeos([boxGeo(2.6, 0.5, 0.8, 0, 0.25, 0), boxGeo(2.4, 0.45, 0.75, 0, 0.72, 0)])), sandMat);
    bags.position.set(s * 4.6, 0, goalZ + 2.5);
    group.add(bags);
    addCollider(s * 4.6, goalZ + 2.5, 1.3, 0.4, 0);
  }
  const signMat = own(new THREE.MeshBasicMaterial({ map: TEX.sign, fog: false }));
  const sign = new THREE.Mesh(own(new THREE.PlaneGeometry(5, 1.25)), signMat);
  sign.position.set(0, 4.4, goalZ - 5.2);
  group.add(sign);
  const posts = new THREE.Mesh(own(mergeGeos([boxGeo(0.15, 4, 0.15, -2.3, 2, 0), boxGeo(0.15, 4, 0.15, 2.3, 2, 0)])), lambert(0x333333));
  posts.position.set(0, 0, goalZ - 5.3);
  group.add(posts);

  /* Pickups ------------------------------------------------------------ */
  const coinSpots = [];
  const items = [];
  for (let cz = -10; cz > -L + 8; cz -= rand(14, 24)) {
    const x = rand(-5, 5);
    const n = 4 + Math.floor(rng() * 4);
    const curve = rng() < 0.4 ? rand(-0.5, 0.5) : 0;
    for (let i = 0; i < n; i++) {
      const px = THREE.MathUtils.clamp(x + curve * i, -6.5, 6.5), pz = cz - i * 1.3;
      if (!blocked(px, pz, 0.4)) coinSpots.push({ x: px, z: pz });
    }
  }
  const makeItem = (kind, ix, iz) => {
    const obj = kind === 'health' ? makeHealthPack() : makeArmorVest();
    const decal = glowDecal(kind === 'health' ? 0x4dff6a : 0x4aa8ff, 2.2, 0.5);
    obj.position.set(ix, 0, iz);
    decal.position.set(ix, 0.04, iz);
    group.add(obj, decal);
    obj.traverse((o) => { if (o.isMesh) disposables.push(o.geometry); });
    return { kind, obj, decal, x: ix, z: iz, taken: false };
  };
  const placeItem = (kind, iz) => {
    for (let tries = 0; tries < 8; tries++) {
      const ix = rand(-5.5, 5.5);
      if (blocked(ix, iz, 0.8)) continue;
      items.push(makeItem(kind, ix, iz));
      return;
    }
  };
  for (let iz = -55; iz > -L + 15; iz -= rand(50, 75)) if (rng() < 0.75) placeItem('health', iz);
  for (let iz = -80; iz > -L + 15; iz -= rand(80, 120)) if (rng() < 0.65) placeItem('armor', iz + rand(-10, 10));

  /* Hordes: where zombies wait. Spawned as you approach. ------------------ */
  const hordes = [];
  for (let hz = -20; hz > -L + 12; hz -= spec.hordeSpacing * rand(0.75, 1.25)) {
    const count = spec.hordeSize[0] + Math.floor(rng() * (spec.hordeSize[1] - spec.hordeSize[0] + 1));
    const nearAlley = alleys.filter((a) => Math.abs(a.z - hz) < 14);
    const alley = nearAlley.length && rng() < spec.sideAmbush ? nearAlley[Math.floor(rng() * nearAlley.length)] : null;
    hordes.push({ z: hz, count, alley, spawned: false });
  }
  if (spec.boss) hordes.push({ z: goalZ + 10, count: 3, alley: null, boss: true, spawned: false });

  // A couple of shamblers right at the start so the first seconds aren't empty.
  hordes.unshift({ z: -11, count: Math.min(2 + level, 4), alley: null, spawned: false, calm: true });

  return {
    group, colliders, alleys, hordes, coinSpots, items, goalZ, length: L, rng,

    /* Drops a pickup where a zombie fell. */
    dropItem(kind, x, z) { items.push(makeItem(kind, x, z)); },

    animate(t) {
      for (const a of animated) {
        if (a.kind === 'fire') {
          const f = 0.85 + Math.sin(t * 17 + a.seed) * 0.08 + Math.sin(t * 29 + a.seed * 2) * 0.07;
          a.flames[0].scale.set(f, 1 / f, 1);
          a.flames[1].scale.set(1 / f, f, 1);
          a.pool.material.opacity = 0.38 + (f - 0.85) * 1.2;
        } else if (a.kind === 'flicker') {
          const on = Math.sin(t * 13 + a.seed) + Math.sin(t * 7.3 + a.seed * 3) > -0.6;
          a.head.visible = on;
          a.pool.visible = on;
        } else if (a.kind === 'goal') {
          const p = 0.5 + 0.5 * Math.sin(t * 3);
          a.ring.material.opacity = 0.55 + p * 0.4;
          a.ring.scale.setScalar(6.6 + p * 0.8);
          a.beam.material.opacity = 0.12 + p * 0.1;
        }
      }
    },

    dispose() {
      scene.remove(group);
      for (const d of disposables) d.dispose();
    },
  };
}

/* Pushes a circle out of every wreck it overlaps. Wrecks are rotated boxes,
   so the circle is moved into each box's own frame, clamped, and moved back. */
export function resolveColliders(colliders, p, radius) {
  for (const c of colliders) {
    const dx = p.x - c.x, dz = p.z - c.z;
    if (Math.abs(dx) > c.r + radius || Math.abs(dz) > c.r + radius) continue;
    // world -> local (rotate by -rot)
    const lx = dx * c.cos - dz * c.sin;
    const lz = dx * c.sin + dz * c.cos;
    const cx = Math.max(-c.hw, Math.min(c.hw, lx));
    const cz = Math.max(-c.hd, Math.min(c.hd, lz));
    let ox = lx - cx, oz = lz - cz;
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
    // local -> world
    p.x = c.x + nx * c.cos + nz * c.sin;
    p.z = c.z - nx * c.sin + nz * c.cos;
  }
}
