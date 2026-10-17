/* Everything you see is built here from boxes and cylinders, with textures
   painted on canvases at start-up, so the game needs no model or image files.
   Geometry and materials are shared between copies wherever possible: on a
   phone, the number of separate meshes drawn each frame is what costs most. */

import * as THREE from '../vendor/three.module.min.js';

/* ── Helpers ─────────────────────────────────────────────────────────── */
export function boxGeo(w, h, d, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/* Joins geometries that share one material into a single mesh. */
export function mergeGeos(geos) {
  let vCount = 0, iCount = 0;
  for (const g of geos) {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
  let vo = 0, io = 0;
  for (const g of geos) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    if (g.index) {
      const a = g.index.array;
      for (let i = 0; i < a.length; i++) idx[io + i] = a[i] + vo;
      io += a.length;
    } else {
      for (let i = 0; i < n; i++) idx[io + i] = vo + i;
      io += n;
    }
    vo += n;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

const matCache = new Map();
// Not JSON.stringify: a texture serialises itself to a data URL when asked.
const keyOf = (color, opts) => color + '|' + Object.entries(opts).map(([k, v]) => k + '=' + (v && v.uuid ? v.uuid : v)).join(',');

export function lambert(color, opts = {}) {
  const key = 'l' + keyOf(color, opts);
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, ...opts });
    matCache.set(key, m);
  }
  return m;
}

export function basic(color, opts = {}) {
  const key = 'b' + keyOf(color, opts);
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, ...opts });
    matCache.set(key, m);
  }
  return m;
}

function canvasTex(w, h, paint, { repeat = false, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/* ── Textures ────────────────────────────────────────────────────────── */
export const TEX = {};

export function initTextures() {
  TEX.glow = canvasTex(128, 128, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, w, h);
  });

  TEX.ring = canvasTex(256, 256, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, w * 0.28, w / 2, h / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,0)');
    r.addColorStop(0.55, 'rgba(255,255,255,1)');
    r.addColorStop(0.7, 'rgba(255,255,255,0.35)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, w, h);
    const f = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.3);
    f.addColorStop(0, 'rgba(255,255,255,0.35)');
    f.addColorStop(1, 'rgba(255,255,255,0.05)');
    g.fillStyle = f;
    g.beginPath(); g.arc(w / 2, h / 2, w * 0.3, 0, Math.PI * 2); g.fill();
  });

  TEX.fire = canvasTex(64, 128, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h * 0.75, 2, w / 2, h * 0.6, h * 0.55);
    r.addColorStop(0, 'rgba(255,250,210,1)');
    r.addColorStop(0.25, 'rgba(255,190,60,0.95)');
    r.addColorStop(0.6, 'rgba(230,70,10,0.55)');
    r.addColorStop(1, 'rgba(120,20,0,0)');
    g.fillStyle = r;
    g.beginPath();
    g.moveTo(w * 0.5, 0);
    g.quadraticCurveTo(w * 1.05, h * 0.55, w * 0.85, h * 0.92);
    g.quadraticCurveTo(w * 0.5, h * 1.02, w * 0.15, h * 0.92);
    g.quadraticCurveTo(-w * 0.05, h * 0.55, w * 0.5, 0);
    g.fill();
  });

  TEX.road = canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = '#2b2d31';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const v = 30 + Math.random() * 40;
      g.fillStyle = `rgba(${v},${v},${v + 4},${0.25 + Math.random() * 0.4})`;
      g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    // cracks and stains
    g.strokeStyle = 'rgba(10,10,12,0.55)';
    for (let i = 0; i < 7; i++) {
      g.lineWidth = 1 + Math.random() * 1.5;
      g.beginPath();
      let x = Math.random() * w, y = Math.random() * h;
      g.moveTo(x, y);
      for (let s = 0; s < 6; s++) { x += (Math.random() - 0.5) * 40; y += (Math.random() - 0.5) * 40; g.lineTo(x, y); }
      g.stroke();
    }
    for (let i = 0; i < 4; i++) {
      g.fillStyle = `rgba(${40 + Math.random() * 30},8,8,${0.18 + Math.random() * 0.2})`;
      g.beginPath();
      g.ellipse(Math.random() * w, Math.random() * h, 10 + Math.random() * 24, 6 + Math.random() * 14, Math.random() * 3, 0, Math.PI * 2);
      g.fill();
    }
    // edge lines and a dashed centre line
    g.fillStyle = 'rgba(210,210,200,0.55)';
    g.fillRect(10, 0, 5, h);
    g.fillRect(w - 15, 0, 5, h);
    g.fillStyle = 'rgba(220,180,60,0.7)';
    for (let y = 0; y < h; y += 128) g.fillRect(w / 2 - 3, y + 20, 6, 70);
  }, { repeat: true });

  TEX.sidewalk = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#4a4b4f';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const v = 60 + Math.random() * 30;
      g.fillStyle = `rgba(${v},${v},${v},0.35)`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    g.strokeStyle = 'rgba(20,20,22,0.6)';
    g.lineWidth = 2;
    for (let y = 0; y <= h; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
  }, { repeat: true });

  // Building facades: a 4 x 4 grid of windows, a few lit. Each variant has a
  // matching emissive map so the lit windows glow through the fog.
  TEX.facades = [];
  for (let v = 0; v < 3; v++) {
    const lit = [];
    for (let i = 0; i < 16; i++) lit.push(Math.random() < 0.18 + v * 0.05);
    const paint = (glow) => (g, w, h) => {
      g.fillStyle = glow ? '#000' : '#8a8580';
      g.fillRect(0, 0, w, h);
      if (!glow) {
        for (let i = 0; i < 500; i++) {
          g.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`;
          g.fillRect(Math.random() * w, Math.random() * h, 3, 3);
        }
      }
      const cw = w / 4, ch = h / 4;
      for (let i = 0; i < 16; i++) {
        const x = (i % 4) * cw + cw * 0.22, y = Math.floor(i / 4) * ch + ch * 0.2;
        const broken = !lit[i] && Math.random() < 0.15;
        if (glow) {
          g.fillStyle = lit[i] ? (Math.random() < 0.7 ? '#ffcf7a' : '#9fd4ff') : '#000';
        } else {
          g.fillStyle = lit[i] ? '#f2d9a0' : broken ? '#0b0b0d' : '#1d2129';
        }
        g.fillRect(x, y, cw * 0.56, ch * 0.6);
        if (!glow) {
          g.fillStyle = 'rgba(0,0,0,0.35)';
          g.fillRect(x, y + ch * 0.6, cw * 0.56, 3);
        }
      }
    };
    const map = canvasTex(256, 256, paint(false), { repeat: true });
    const emissive = canvasTex(256, 256, paint(true), { repeat: true });
    TEX.facades.push({ map, emissive });
  }

  TEX.brick = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#3a2a24';
    g.fillRect(0, 0, w, h);
    const bw = 64, bh = 24;
    for (let row = 0; row * bh < h; row++) {
      for (let col = -1; col * bw < w; col++) {
        const x = col * bw + (row % 2 ? bw / 2 : 0), y = row * bh;
        const v = 120 + Math.random() * 50;
        g.fillStyle = `rgb(${v},${v * 0.55},${v * 0.42})`;
        g.fillRect(x + 2, y + 2, bw - 4, bh - 4);
        for (let k = 0; k < 6; k++) {
          g.fillStyle = `rgba(0,0,0,${Math.random() * 0.18})`;
          g.fillRect(x + Math.random() * bw, y + Math.random() * bh, 4, 3);
        }
      }
    }
  }, { repeat: true });

  TEX.scorch = canvasTex(128, 128, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,0.95)');
    r.addColorStop(0.5, 'rgba(255,255,255,0.6)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    for (let i = 0; i < 9; i++) {
      g.beginPath();
      const a = Math.random() * Math.PI * 2, d = Math.random() * 18;
      g.arc(w / 2 + Math.cos(a) * d, h / 2 + Math.sin(a) * d, 24 + Math.random() * 30, 0, Math.PI * 2);
      g.fill();
    }
  });

  // Smoke: a cluster of soft blobs with uneven shading, so a sprite reads as
  // a billow rather than a disc. White, tinted per sprite.
  TEX.smoke = canvasTex(128, 128, (g, w, h) => {
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * w * 0.2;
      const x = w / 2 + Math.cos(a) * d, y = h / 2 + Math.sin(a) * d, r = w * (0.16 + Math.random() * 0.16);
      const v = Math.round(185 + Math.random() * 70);
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(${v},${v},${v},0.32)`);
      grad.addColorStop(1, `rgba(${v},${v},${v},0)`);
      g.fillStyle = grad;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    // fade the edges so no sprite shows a square
    g.globalCompositeOperation = 'destination-in';
    const edge = g.createRadialGradient(w / 2, h / 2, w * 0.2, w / 2, h / 2, w / 2);
    edge.addColorStop(0, 'rgba(0,0,0,1)');
    edge.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = edge;
    g.fillRect(0, 0, w, h);
  });

  // Flame / glow: a hot core with a long soft falloff.
  TEX.flame = canvasTex(64, 64, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.18, 'rgba(255,255,255,0.85)');
    r.addColorStop(0.45, 'rgba(255,255,255,0.3)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, w, h);
  });

  // Condemned facade: grimy concrete panels with cracks and dead windows.
  TEX.condemned = canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = '#6a6560';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.15})`;
      g.fillRect(Math.random() * w, Math.random() * h, 3, 3);
    }
    for (let y = 30; y < h; y += 72) {
      for (let x = 20; x < w; x += 78) {
        g.fillStyle = Math.random() < 0.3 ? '#0a0a0a' : '#1a1d22';
        g.fillRect(x, y, 44, 40);
        g.fillStyle = 'rgba(0,0,0,0.4)';
        g.fillRect(x - 3, y + 40, 50, 5);
      }
    }
    g.strokeStyle = 'rgba(15,12,10,0.85)';
    for (let i = 0; i < 9; i++) {
      g.lineWidth = 1.5 + Math.random() * 2.5;
      g.beginPath();
      let x = Math.random() * w, y = Math.random() * h;
      g.moveTo(x, y);
      for (let s = 0; s < 9; s++) { x += (Math.random() - 0.5) * 50; y += Math.random() * 40; g.lineTo(x, y); }
      g.stroke();
    }
    g.fillStyle = 'rgba(40,20,10,0.25)';
    g.fillRect(0, h * 0.82, w, h * 0.18);
  }, { repeat: true });

  TEX.danger = canvasTex(256, 96, (g, w, h) => {
    g.fillStyle = '#e8c21e';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#141414';
    for (let x = -h; x < w; x += 40) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 20, 0); g.lineTo(x + 20 + h, h); g.lineTo(x + h, h); g.fill();
    }
    g.fillStyle = '#141414';
    g.fillRect(28, 18, w - 56, h - 36);
    g.fillStyle = '#e8c21e';
    g.font = '52px "Bebas Neue", Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('CONDEMNED', w / 2, h / 2 + 2);
  });

  TEX.sign = canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = '#0d1a10';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#7dff8a';
    g.lineWidth = 8;
    g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = '#9dff9a';
    g.font = '84px "Bebas Neue", Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('SAFE ZONE', w / 2, h / 2 + 4);
  });
}

/* ── Shared geometry ─────────────────────────────────────────────────── */
let G = null;
function geos() {
  if (G) return G;
  G = {
    leg: boxGeo(0.24, 0.82, 0.26, 0, -0.41, 0),
    arm: boxGeo(0.19, 0.72, 0.2, 0, -0.34, 0),
    torso: boxGeo(0.62, 0.72, 0.36),
    head: boxGeo(0.4, 0.42, 0.4, 0, 0.21, 0),
    eyes: mergeGeos([boxGeo(0.09, 0.06, 0.03, -0.09, 0.25, 0.205), boxGeo(0.09, 0.06, 0.03, 0.09, 0.25, 0.205)]),
    pack: boxGeo(0.46, 0.5, 0.2, 0, 1.2, -0.27),
    cap: boxGeo(0.44, 0.12, 0.5, 0, 0.46, 0.04),
    helmet: mergeGeos([boxGeo(0.5, 0.26, 0.5, 0, 0.42, 0), boxGeo(0.44, 0.08, 0.06, 0, 0.3, 0.24)]),
    goggles: mergeGeos([boxGeo(0.44, 0.06, 0.44, 0, 0.3, 0), boxGeo(0.12, 0.1, 0.05, -0.09, 0.3, 0.215), boxGeo(0.12, 0.1, 0.05, 0.09, 0.3, 0.215)]),
    hood: mergeGeos([boxGeo(0.48, 0.12, 0.48, 0, 0.47, -0.02), boxGeo(0.06, 0.4, 0.46, -0.23, 0.22, -0.02), boxGeo(0.06, 0.4, 0.46, 0.23, 0.22, -0.02), boxGeo(0.48, 0.4, 0.06, 0, 0.22, -0.23)]),
    grenade: new THREE.SphereGeometry(0.13, 10, 8),
    flat: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    coin: new THREE.CylinderGeometry(0.24, 0.24, 0.07, 14).rotateX(Math.PI / 2),
    tracer: boxGeo(0.06, 0.06, 1.1),
    particle: new THREE.BoxGeometry(1, 1, 1),
  };
  return G;
}
export const sharedGeo = () => geos();

/* Hit flash: a zombie's meshes swap to this for a few frames. */
export const FLASH_MAT = new THREE.MeshBasicMaterial({ color: 0xffd8c8 });

export function blobShadow(size = 1.1, opacity = 0.55) {
  const m = new THREE.Mesh(geos().flat, basic(0x000000, { map: TEX.glow, transparent: true, opacity, depthWrite: false }));
  m.scale.set(size, 1, size);
  m.position.y = 0.02;
  m.renderOrder = -1;
  return m;
}

/* A soft additive pool of light on the ground. Pass own: true when the
   caller animates its opacity, and dispose the material yourself. */
export function glowDecal(color, size, opacity = 0.6, { own = false, map = TEX.glow } = {}) {
  const opts = { map, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending };
  const m = new THREE.Mesh(geos().flat, own ? new THREE.MeshBasicMaterial({ color, ...opts }) : basic(color, opts));
  m.scale.set(size, 1, size);
  m.position.y = 0.03;
  return m;
}

/* ── Characters ──────────────────────────────────────────────────────────
   Faces +z. Pivots sit at the hips, shoulders and neck so limbs swing
   naturally. `body` is a sub-group the death fall rotates.                */
export function makeHumanoid({ skin, shirt, pants, sleeves = skin, eyes = null, scale = 1, shadow = 1.1 }) {
  const g = geos();
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const mk = (geo, mat, parent, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.userData.mat = mat;
    parent.add(m);
    return m;
  };
  const pivot = (x, y, z) => {
    const p = new THREE.Group();
    p.position.set(x, y, z);
    body.add(p);
    return p;
  };

  const legL = pivot(0.15, 0.82, 0);
  const legR = pivot(-0.15, 0.82, 0);
  const armL = pivot(0.42, 1.48, 0);
  const armR = pivot(-0.42, 1.48, 0);
  const head = pivot(0, 1.54, 0);

  const meshes = [
    mk(g.torso, shirt, body, 0, 1.18, 0),
    mk(g.leg, pants, legL),
    mk(g.leg, pants, legR),
    mk(g.arm, sleeves, armL),
    mk(g.arm, sleeves, armR),
    mk(g.head, skin, head),
  ];
  if (eyes) mk(g.eyes, eyes, head);

  if (shadow) root.add(blobShadow(shadow));
  root.scale.setScalar(scale);
  return { root, body, legL, legR, armL, armR, head, meshes };
}

const ZSKIN = [0x7d9a6a, 0x8aa07a, 0x6b8560, 0x95a487, 0x7a8f74];
const ZSHIRT = [0x5a4a3a, 0x3a4a5a, 0x6a3434, 0x4a4a4a, 0x7a6a4a, 0x2f4a3a, 0x6a5a6e];
const ZPANTS = [0x2f2f3a, 0x3a3226, 0x26303a, 0x403a30];

export function makeZombie(kind, rng, eyeColor) {
  const pick = (a) => a[Math.floor(rng() * a.length)];
  let skin = pick(ZSKIN), shirt = pick(ZSHIRT), pants = pick(ZPANTS), sleeves;
  if (kind === 'runner') { skin = 0xa9b49c; shirt = pick([0x6a3434, 0x4a4a4a, 0x3a3a5a]); }
  if (kind === 'tank') { skin = 0x5f7a50; shirt = skin; pants = 0x2a2a26; }
  if (kind === 'boss') { skin = 0x7a5a50; shirt = 0x5a3a34; pants = 0x231c1a; }
  sleeves = kind === 'walker' && rng() < 0.5 ? shirt : skin;
  return makeHumanoid({
    skin: lambert(skin), shirt: lambert(shirt), pants: lambert(pants), sleeves: lambert(sleeves),
    eyes: basic(eyeColor, { fog: false }),
  });
}

/* A survivor from CHARACTERS (src/config.js): their colours, headgear and
   build, plus a bright ring underfoot so you never lose yourself in a crowd. */
export function makeSurvivor(look) {
  const h = makeHumanoid({
    skin: lambert(look.skin), shirt: lambert(look.shirt), pants: lambert(look.pants),
    sleeves: lambert(look.shirt), eyes: basic(0x111111),
  });
  h.root.add(glowDecal(0x9be15d, 2.1, 0.4, { map: TEX.ring }));
  const g = geos();
  h.body.add(new THREE.Mesh(g.pack, lambert(0x3d3226)));
  const hat = { cap: g.cap, helmet: g.helmet, goggles: g.goggles, hood: g.hood }[look.hat];
  if (hat) h.head.add(new THREE.Mesh(hat, look.hat === 'goggles' ? basic(look.hatColor) : lambert(look.hatColor)));
  if (look.bulk) {
    h.body.children[0].scale.set(look.bulk, 1, look.bulk);   // torso
  }
  return h;
}

/* ── Guns ────────────────────────────────────────────────────────────────
   Barrel points along +z. `len` is where the muzzle is.                  */
const GUNS = {
  pistol:  { len: 0.34, w: 0.09, h: 0.14, color: 0x2a2a2e },
  smg:     { len: 0.5,  w: 0.1,  h: 0.16, color: 0x34363c, mag: true },
  shotgun: { len: 0.82, w: 0.1,  h: 0.13, color: 0x5a3a24, barrel: 0x2a2a2a },
  rifle:   { len: 0.8,  w: 0.1,  h: 0.15, color: 0x3a4232, mag: true },
  minigun: { len: 0.86, w: 0.2,  h: 0.2,  color: 0x2e2e33, barrels: true },
  launcher: { len: 0.72, w: 0.17, h: 0.17, color: 0x46532f, drum: true },
};

export function makeGun(id) {
  const s = GUNS[id] || GUNS.pistol;
  const parts = [boxGeo(s.w, s.h, s.len, 0, 0, s.len / 2), boxGeo(s.w * 0.8, 0.18, 0.1, 0, -0.12, 0.08)];
  if (s.mag) parts.push(boxGeo(s.w * 0.7, 0.22, 0.1, 0, -0.16, s.len * 0.5));
  const group = new THREE.Group();
  group.add(new THREE.Mesh(mergeGeos(parts), lambert(s.color)));
  if (s.drum) {
    group.add(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.22, 10).rotateX(Math.PI / 2).translate(0, -0.02, 0.22), lambert(0x2a2f22)));
  }
  if (s.barrel) group.add(new THREE.Mesh(boxGeo(0.06, 0.06, s.len * 0.55, 0, 0.07, s.len * 0.72), lambert(s.barrel)));
  if (s.barrels) {
    const b = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      b.push(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 6).rotateX(Math.PI / 2).translate(Math.cos(a) * 0.06, Math.sin(a) * 0.06, s.len + 0.12));
    }
    group.add(new THREE.Mesh(mergeGeos(b), lambert(0x55555c)));
  }
  return { group, len: s.barrels ? s.len + 0.37 : s.len };
}

/* ── Props ───────────────────────────────────────────────────────────── */
const CAR_COLORS = [0x6e2b26, 0x2d4660, 0x4b5a3a, 0x7a7466, 0x2a2a2e, 0x8a6a2a, 0x5a5f66];
let CAR_GEO = null;
function carGeos() {
  if (CAR_GEO) return CAR_GEO;
  const wheels = [];
  for (const [x, z] of [[-0.92, 1.35], [0.92, 1.35], [-0.92, -1.35], [0.92, -1.35]]) {
    wheels.push(new THREE.CylinderGeometry(0.37, 0.37, 0.28, 10).rotateZ(Math.PI / 2).translate(x, 0.37, z));
  }
  CAR_GEO = {
    body: mergeGeos([boxGeo(1.9, 0.62, 4.2, 0, 0.66, 0), boxGeo(1.84, 0.12, 0.3, 0, 0.42, 2.0), boxGeo(1.84, 0.12, 0.3, 0, 0.42, -2.0)]),
    cabin: boxGeo(1.7, 0.6, 2.1, 0, 1.27, -0.25),
    wheels: mergeGeos(wheels),
    lights: mergeGeos([boxGeo(0.34, 0.12, 0.04, -0.66, 0.78, -2.11), boxGeo(0.34, 0.12, 0.04, 0.66, 0.78, -2.11)]),
    heads: mergeGeos([boxGeo(0.34, 0.12, 0.04, -0.66, 0.78, 2.11), boxGeo(0.34, 0.12, 0.04, 0.66, 0.78, 2.11)]),
  };
  return CAR_GEO;
}

/* Burnt-out wreck materials, swapped in when a vehicle blows up. */
export const BURNT = {
  get body() { return lambert(0x1e1b18); },
  get glass() { return lambert(0x0a0a0a); },
  get lamp() { return basic(0x1a1210); },
};

export function makeCar(rng) {
  const g = carGeos();
  const group = new THREE.Group();
  const body = keep(new THREE.Mesh(g.body, lambert(CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)])));
  const cabin = keep(new THREE.Mesh(g.cabin, lambert(0x1a1f26)));
  const lights = new THREE.Mesh(g.lights, basic(0x7a1010));
  const heads = new THREE.Mesh(g.heads, basic(rng() < 0.25 ? 0xfff0b0 : 0x4a4a40));
  const shadow = blobShadow(4.4, 0.5);
  group.add(body, cabin, new THREE.Mesh(g.wheels, lambert(0x141414)), lights, heads, shadow);
  return { group, meshes: [body, cabin], burn: { body, cabin, lights, heads }, shadow, hw: 0.95, hd: 2.1, height: 1.6 };
}

/* A fuel tanker: cab, chassis and a long tank. Rare, and very explosive. */
let TANKER_GEO = null;
export function makeTanker(rng) {
  if (!TANKER_GEO) {
    const wheels = [];
    for (const z of [2.6, 1.0, -1.6, -2.8]) for (const x of [-1.05, 1.05]) {
      wheels.push(new THREE.CylinderGeometry(0.46, 0.46, 0.32, 10).rotateZ(Math.PI / 2).translate(x, 0.46, z));
    }
    TANKER_GEO = {
      cab: mergeGeos([boxGeo(2.2, 1.5, 1.9, 0, 1.25, 2.55), boxGeo(2.2, 0.9, 0.9, 0, 2.4, 2.4)]),
      glass: boxGeo(2.0, 0.6, 0.06, 0, 2.15, 3.52),
      chassis: boxGeo(1.6, 0.3, 7.2, 0, 0.75, -0.1),
      tank: new THREE.CylinderGeometry(1.15, 1.15, 5.2, 16).rotateX(Math.PI / 2).translate(0, 2.0, -1.1),
      bands: mergeGeos([-3.2, -1.1, 1.0].map((z) => new THREE.CylinderGeometry(1.18, 1.18, 0.14, 16).rotateX(Math.PI / 2).translate(0, 2.0, z))),
      wheels: mergeGeos(wheels),
    };
  }
  const G = TANKER_GEO;
  const group = new THREE.Group();
  const cab = keep(new THREE.Mesh(G.cab, lambert([0x8a2a22, 0x2a4a6a, 0xd0c8b0][Math.floor(rng() * 3)])));
  const tank = keep(new THREE.Mesh(G.tank, lambert(0xb8b8b0)));
  const bands = keep(new THREE.Mesh(G.bands, basic(0xe08a1a)));
  const glass = new THREE.Mesh(G.glass, lambert(0x1a1f26));
  group.add(cab, tank, bands, glass, new THREE.Mesh(G.chassis, lambert(0x222222)), new THREE.Mesh(G.wheels, lambert(0x141414)));
  const shadow = blobShadow(8, 0.55);
  shadow.scale.set(3.2, 1, 8);
  group.add(shadow);
  return { group, meshes: [cab, tank, bands], burn: { body: cab, cabin: tank, lights: bands, heads: glass }, shadow, hw: 1.15, hd: 3.6, height: 3.1 };
}

/* A condemned building front on the sidewalk, scaffolded and taped off.
   Its long side runs along the road (local z); it falls toward local +x. */
export function makeCondemned(width, height) {
  const d = 1.2;
  const g = new THREE.BoxGeometry(d, height, width);
  const uv = g.attributes.uv;
  const dims = [[width, height], [width, height], [d, width], [d, width], [d, height], [d, height]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * dims[f][0] / 8, uv.getY(i) * dims[f][1] / 16);
    }
  }
  g.translate(0, height / 2, 0);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: TEX.condemned });
  const slab = keep(new THREE.Mesh(g, mat));
  // Scaffolding: a grid of thin poles and planks on the road side.
  const bars = [];
  for (let z = -width / 2; z <= width / 2 + 0.01; z += width / 4) bars.push(boxGeo(0.08, height * 0.8, 0.08, d / 2 + 0.6, height * 0.4, z));
  for (let y = 2.5; y < height * 0.8; y += 2.5) {
    bars.push(boxGeo(0.06, 0.06, width, d / 2 + 0.6, y, 0));
    bars.push(boxGeo(0.7, 0.05, width, d / 2 + 0.3, y, 0));
  }
  const scaffold = new THREE.Mesh(mergeGeos(bars), lambert(0x8a6a3a));
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.98), new THREE.MeshBasicMaterial({ map: TEX.danger }));
  sign.rotation.y = Math.PI / 2;
  sign.position.set(d / 2 + 0.9, 2.2, 0);
  const tape = new THREE.Mesh(boxGeo(0.04, 0.12, width, d / 2 + 0.95, 1.1, 0), basic(0xe8c21e));
  const group = new THREE.Group();
  group.add(slab, scaffold, sign, tape);
  return { group, meshes: [slab], hw: d / 2 + 0.9, hd: width / 2, height, own: [g, mat, scaffold.geometry, sign.geometry, sign.material, tape.geometry] };
}

/* A broken-off chunk of concrete for collapses. */
export function makeSlab(rng, w, h, d) {
  const g = boxGeo(w, h, d, 0, h / 2, 0);
  const mesh = keep(new THREE.Mesh(g, lambert(0x7a746c)));
  const group = new THREE.Group();
  group.add(mesh);
  return { group, meshes: [mesh], hw: w / 2, hd: d / 2, height: h, own: [g] };
}

let BARRIER_GEO = null;
export function makeBarrier() {
  if (!BARRIER_GEO) {
    BARRIER_GEO = {
      block: mergeGeos([boxGeo(2.4, 0.55, 0.62, 0, 0.275, 0), boxGeo(2.4, 0.38, 0.3, 0, 0.74, 0)]),
      stripe: boxGeo(2.42, 0.12, 0.32, 0, 0.82, 0),
    };
  }
  const group = new THREE.Group();
  const meshes = [
    keep(new THREE.Mesh(BARRIER_GEO.block, lambert(0x8d8a82))),
    keep(new THREE.Mesh(BARRIER_GEO.stripe, lambert(0xd8582a))),
  ];
  group.add(...meshes);
  return { group, meshes, hw: 1.2, hd: 0.32, height: 0.95 };
}

let LAMP_GEO = null;
export function makeLamp() {
  if (!LAMP_GEO) {
    LAMP_GEO = {
      pole: mergeGeos([new THREE.CylinderGeometry(0.08, 0.11, 5.4, 8).translate(0, 2.7, 0), boxGeo(0.1, 0.1, 1.6, 0, 5.35, 0.75)]),
      head: boxGeo(0.34, 0.12, 0.5, 0, 5.28, 1.5),
    };
  }
  const group = new THREE.Group();
  const pole = keep(new THREE.Mesh(LAMP_GEO.pole, lambert(0x3a3c40)));
  group.add(pole);
  const head = new THREE.Mesh(LAMP_GEO.head, basic(0xffc979));
  group.add(head);
  const pool = glowDecal(0xff9a3a, 7.5, 0.32);
  pool.position.set(0, 0.03, 1.6);
  group.add(pool);
  // The collider is just the pole; the arm overhangs the road.
  return { group, head, pool, meshes: [pole], hw: 0.13, hd: 0.13, height: 5.4 };
}

let BARREL_GEO = null;
export function makeFireBarrel() {
  if (!BARREL_GEO) BARREL_GEO = new THREE.CylinderGeometry(0.34, 0.34, 0.95, 10).translate(0, 0.475, 0);
  const group = new THREE.Group();
  const drum = keep(new THREE.Mesh(BARREL_GEO, lambert(0x5a3a26)));
  group.add(drum);
  const flameMat = new THREE.MeshBasicMaterial({
    map: TEX.fire, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const flames = [];
  for (let i = 0; i < 2; i++) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.4), flameMat);
    f.position.y = 1.55;
    f.rotation.y = i * Math.PI / 2;
    group.add(f);
    flames.push(f);
  }
  const pool = glowDecal(0xff7a2a, 6, 0.5, { own: true });
  group.add(pool);
  return { group, flames, pool, meshes: [drum], hw: 0.36, hd: 0.36, height: 0.95 };
}

export function makeHealthPack() {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(boxGeo(0.62, 0.38, 0.46, 0, 0.19, 0), lambert(0xf2f2ee)));
  group.add(new THREE.Mesh(mergeGeos([boxGeo(0.14, 0.02, 0.36, 0, 0.39, 0), boxGeo(0.4, 0.02, 0.12, 0, 0.39, 0)]), basic(0xe02a2a)));
  return group;
}

export function makeArmorVest() {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(mergeGeos([boxGeo(0.62, 0.56, 0.22, 0, 0.3, 0), boxGeo(0.16, 0.2, 0.2, -0.2, 0.66, 0), boxGeo(0.16, 0.2, 0.2, 0.2, 0.66, 0)]), lambert(0x2f4f7a)));
  group.add(new THREE.Mesh(boxGeo(0.64, 0.08, 0.24, 0, 0.32, 0), basic(0x7ac8ff)));
  return group;
}

/* ── Props you can wreck ─────────────────────────────────────────────────
   Each returns { group, meshes, hw, hd, height }. `meshes` are the ones a
   hit flashes; their original material is kept in userData.mat.          */
const keep = (m) => { m.userData.mat = m.material; return m; };

let XBARREL = null;
export function makeExplosiveBarrel() {
  if (!XBARREL) {
    XBARREL = {
      body: new THREE.CylinderGeometry(0.33, 0.33, 1.0, 12).translate(0, 0.5, 0),
      band: new THREE.CylinderGeometry(0.336, 0.336, 0.16, 12).translate(0, 0.62, 0),
      lid: new THREE.CylinderGeometry(0.28, 0.28, 0.04, 12).translate(0, 1.01, 0),
    };
  }
  const group = new THREE.Group();
  const meshes = [
    keep(new THREE.Mesh(XBARREL.body, lambert(0xb3261e))),
    keep(new THREE.Mesh(XBARREL.band, basic(0xffc21a))),
    keep(new THREE.Mesh(XBARREL.lid, lambert(0x6a1a14))),
  ];
  group.add(...meshes, blobShadow(1.1, 0.45));
  return { group, meshes, hw: 0.34, hd: 0.34, height: 1.0 };
}

export function makeWall(width) {
  const h = 2.4, d = 0.45;
  const g = new THREE.BoxGeometry(width, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [width, d], [width, d], [width, h], [width, h]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * dims[f][0] / 2, uv.getY(i) * dims[f][1] / 1);
    }
  }
  g.translate(0, h / 2, 0);
  // Its own material, so damage can darken this wall alone.
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: TEX.brick });
  const wall = keep(new THREE.Mesh(g, mat));
  const cap = keep(new THREE.Mesh(boxGeo(width + 0.08, 0.12, d + 0.08, 0, h + 0.06, 0), lambert(0x6a6460)));
  const group = new THREE.Group();
  group.add(wall, cap);
  return { group, meshes: [wall, cap], hw: width / 2, hd: d / 2, height: h, own: [g, mat, cap.geometry] };
}

/* A low pile of broken bits covering w x d metres. One merged mesh. */
export function makeRubble(rng, w, d, color = 0x6d625a) {
  const parts = [];
  const n = Math.max(6, Math.round(w * d * 3));
  for (let i = 0; i < n; i++) {
    const s = 0.18 + rng() * 0.4;
    const geo = boxGeo(s, s * (0.4 + rng() * 0.6), s * (0.6 + rng()), (rng() - 0.5) * w, s * 0.2, (rng() - 0.5) * d);
    geo.rotateY((rng() - 0.5) * 0.6);
    parts.push(geo);
  }
  const mesh = new THREE.Mesh(mergeGeos(parts), lambert(color));
  return { mesh, own: [mesh.geometry] };
}

export function scorchDecal(size) {
  const m = new THREE.Mesh(geos().flat, basic(0x000000, { map: TEX.scorch, transparent: true, opacity: 0.7, depthWrite: false }));
  m.scale.set(size, 1, size);
  m.position.y = 0.025;
  return m;
}
