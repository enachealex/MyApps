/* Fire, smoke, dust and sparks.

   Two pools of camera-facing sprites, each drawn in one call: an additive
   pool for anything that glows (flash, fireball, sparks, embers, flames)
   and an ordinary blended pool for anything that hides what's behind it
   (smoke, dust). Every sprite has its own velocity, drag, buoyancy, size
   and colour over its life. Explosions are recipes built from those, plus a
   shock ring on the ground; burning wrecks and smoking cars are emitters
   that spawn sprites every frame until they run out.

   Sprite counts scale with the Graphics setting, because on a phone it's
   the overlapping smoke (overdraw), not the maths, that costs frames. */

import * as THREE from '../vendor/three.module.min.js';
import { TEX } from './models.js';

const MAX_GLOW = 420;
const MAX_SMOKE = 300;
const MAX_RINGS = 6;

const VERT = /* glsl */`
  attribute vec3 offset;
  attribute vec4 tint;
  attribute vec2 sizeRot;
  varying vec2 vUv;
  varying vec4 vTint;
  varying float vDepth;
  void main() {
    vec4 mv = modelViewMatrix * vec4(offset, 1.0);
    float c = cos(sizeRot.y), s = sin(sizeRot.y);
    vec2 p = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * sizeRot.x;
    mv.xy += p;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
    vUv = uv;
    vTint = tint;
  }
`;
const FRAG = /* glsl */`
  uniform sampler2D map;
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  uniform float additive;
  varying vec2 vUv;
  varying vec4 vTint;
  varying float vDepth;
  void main() {
    vec4 t = texture2D(map, vUv);
    float fog = smoothstep(fogNear, fogFar, vDepth);
    vec3 col = t.rgb * vTint.rgb;
    float a = t.a * vTint.a;
    if (additive > 0.5) {
      gl_FragColor = vec4(col * a * (1.0 - fog), 1.0);
    } else {
      gl_FragColor = vec4(mix(col, fogColor, fog), a * (1.0 - fog * 0.6));
    }
  }
`;

class SpritePool {
  constructor(scene, max, map, additive) {
    this.max = max;
    this.items = [];
    const g = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    g.index = quad.index;
    g.setAttribute('position', quad.attributes.position);
    g.setAttribute('uv', quad.attributes.uv);
    this.offset = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.tint = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.sizeRot = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('offset', this.offset);
    g.setAttribute('tint', this.tint);
    g.setAttribute('sizeRot', this.sizeRot);
    g.instanceCount = 0;
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: map }, fogColor: { value: new THREE.Color() }, fogNear: { value: 20 }, fogFar: { value: 60 },
        additive: { value: additive ? 1 : 0 },
      },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.CustomBlending : THREE.NormalBlending,
    });
    if (additive) {
      this.mat.blendEquation = THREE.AddEquation;
      this.mat.blendSrc = THREE.OneFactor;
      this.mat.blendDst = THREE.OneFactor;
    }
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 3 : 2;
    scene.add(this.mesh);
  }

  /* A sprite: position, velocity, life, and start/end size, colour, alpha. */
  add(p) {
    if (this.items.length >= this.max) {
      // Full: recycle the oldest, so a new explosion always shows.
      this.items.shift();
    }
    p.age = 0;
    p.rot = p.rot ?? Math.random() * 6.28;
    p.spin = p.spin ?? (Math.random() - 0.5) * 1.5;
    this.items.push(p);
  }

  update(dt) {
    const it = this.items;
    for (let i = it.length - 1; i >= 0; i--) {
      const p = it[i];
      p.age += dt;
      if (p.age >= p.life) { it.splice(i, 1); continue; }
      const drag = Math.exp(-(p.drag || 0) * dt);
      p.vx *= drag; p.vy *= drag; p.vz *= drag;
      p.vy += (p.lift || 0) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < p.floor) { p.y = p.floor; p.vy = Math.abs(p.vy) * 0.2; }
      p.rot += p.spin * dt;
    }
  }

  draw(fog) {
    const it = this.items;
    const o = this.offset.array, t = this.tint.array, sr = this.sizeRot.array;
    for (let i = 0; i < it.length; i++) {
      const p = it[i];
      const k = p.age / p.life;
      // fade in over the first sliver, out over the rest
      const fade = Math.min(1, k / (p.fadeIn || 0.06)) * (1 - Math.pow(k, p.fadePow || 1.6));
      o[i * 3] = p.x; o[i * 3 + 1] = p.y; o[i * 3 + 2] = p.z;
      const c0 = p.c0, c1 = p.c1 || p.c0;
      const ck = Math.min(1, k * (p.colorSpeed || 1));
      t[i * 4] = c0[0] + (c1[0] - c0[0]) * ck;
      t[i * 4 + 1] = c0[1] + (c1[1] - c0[1]) * ck;
      t[i * 4 + 2] = c0[2] + (c1[2] - c0[2]) * ck;
      t[i * 4 + 3] = (p.a ?? 1) * fade;
      sr[i * 2] = p.s0 + (p.s1 - p.s0) * (1 - Math.pow(1 - k, p.grow || 2));
      sr[i * 2 + 1] = p.rot;
    }
    this.geo.instanceCount = it.length;
    this.offset.needsUpdate = this.tint.needsUpdate = this.sizeRot.needsUpdate = true;
    if (fog) {
      this.mat.uniforms.fogColor.value.copy(fog.color);
      this.mat.uniforms.fogNear.value = fog.near;
      this.mat.uniforms.fogFar.value = fog.far;
    }
  }

  clear() { this.items.length = 0; }
}

const rgb = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const HOT = rgb(0xfff0c8), FIRE = rgb(0xff8a24), DEEP = rgb(0xe24a0c), EMBER = rgb(0xff5a14), DARKFIRE = rgb(0x4a1206);
const SMOKE_LIGHT = rgb(0x8a8680), SMOKE_DARK = rgb(0x262422), DUST = rgb(0x9a8e7c), SPARK = rgb(0xffd890);

export class VFX {
  constructor(scene) {
    this.scene = scene;
    this.glow = new SpritePool(scene, MAX_GLOW, TEX.flame, true);
    this.smokes = new SpritePool(scene, MAX_SMOKE, TEX.smoke, false);
    this.emitters = [];
    this.scale = 1;            // 0.5 on "Battery saver"
    this.rings = [];
    for (let i = 0; i < MAX_RINGS; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
        map: TEX.ring, color: 0xffc890, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0,
      }));
      m.visible = false;
      m.position.y = 0.06;
      scene.add(m);
      this.rings.push({ mesh: m, t: 1, life: 0.4, size: 1 });
    }
  }

  setQuality(q) { this.scale = q === 'low' ? 0.5 : 1; }

  n(count) { return Math.max(1, Math.round(count * this.scale)); }

  clear() {
    this.glow.clear();
    this.smokes.clear();
    this.emitters.length = 0;
    for (const r of this.rings) { r.t = r.life; r.mesh.visible = false; }
  }

  /* ── Recipes ─────────────────────────────────────────────────────────── */

  /* A blast. size ~ radius in metres (barrel 3.8, car 5, tanker 8.5). */
  explosion(x, y, z, size = 4) {
    const R = Math.random;
    const s = size / 4;
    // 1. The flash: one big warm sprite for an instant.
    this.glow.add({ x, y: y + 0.8, z, vx: 0, vy: 0, vz: 0, life: 0.09, s0: size * 1.1, s1: size * 1.7, c0: [1, 0.82, 0.55], a: 0.75, fadeIn: 0.01, fadePow: 1 });
    // 2. The fireball: a few white-hot cores, then a mass of orange that
    //    rolls outward and upward, cooling to dark red as it slows.
    for (let i = 0; i < this.n(22 * s + 6); i++) {
      const a = R() * 6.28, up = R(), sp = (2.5 + R() * 5.5) * s, core = i < 4;
      this.glow.add({
        x: x + Math.cos(a) * 0.3, y: y + 0.4 + up * 0.8, z: z + Math.sin(a) * 0.3,
        vx: Math.cos(a) * sp * (1 - up * 0.5), vy: 1.5 + up * 6 * s, vz: Math.sin(a) * sp * (1 - up * 0.5),
        drag: 3, lift: 1.6, floor: 0.2,
        life: 0.6 + R() * 0.6, s0: (0.8 + R()) * s, s1: (2.6 + R() * 2) * s,
        c0: core ? HOT : (R() < 0.5 ? FIRE : DEEP), c1: DARKFIRE, colorSpeed: 1.2,
        a: core ? 0.8 : 0.55, fadeIn: 0.03, fadePow: 1.2,
      });
    }
    // 3. Smoke: a dark column that keeps rising and spreading after the fire.
    for (let i = 0; i < this.n(14 * s + 4); i++) {
      const a = R() * 6.28, sp = (1 + R() * 3) * s;
      this.smokes.add({
        x: x + Math.cos(a) * 0.5, y: y + 0.8 + R() * 1.2 * s, z: z + Math.sin(a) * 0.5,
        vx: Math.cos(a) * sp, vy: 1.5 + R() * 2.5 * s, vz: Math.sin(a) * sp,
        drag: 1.4, lift: 0.9, floor: 0.5,
        life: 3 + R() * 3 * s, s0: (1.2 + R()) * s, s1: (4 + R() * 3) * s,
        c0: SMOKE_DARK, c1: SMOKE_LIGHT, colorSpeed: 0.7, a: 0.75, fadeIn: 0.12, fadePow: 1.1, grow: 1.6,
      });
    }
    // 4. Sparks: fast, small, falling.
    this.sparks(x, y + 0.6, z, this.n(26 * s + 8), 14 * s, 1.1);
    // 5. Embers: slow glowing bits drifting up for a few seconds.
    for (let i = 0; i < this.n(10 * s); i++) {
      const a = R() * 6.28;
      this.glow.add({
        x, y: y + 1, z, vx: Math.cos(a) * 2 * s, vy: 2 + R() * 3, vz: Math.sin(a) * 2 * s,
        drag: 1.2, lift: 0.6, life: 2 + R() * 2, s0: 0.12, s1: 0.06, c0: FIRE, c1: EMBER, a: 0.9,
      });
    }
    // 6. Dust thrown along the ground, and the shock ring.
    this.dust(x, z, size * 0.9, this.n(10 * s + 4));
    this.ring(x, z, size * 3.2, 0.45);
  }

  /* Smaller pop for grenades hitting the ground: same recipe, less of it. */
  pop(x, y, z, size) { this.explosion(x, y, z, size * 0.85); }

  sparks(x, y, z, n, speed = 9, life = 0.5, dir = null) {
    const R = Math.random;
    for (let i = 0; i < n; i++) {
      let vx, vy, vz;
      if (dir) {
        // a cone back toward the shooter
        vx = dir.x * speed * (0.3 + R()) + (R() - 0.5) * speed * 0.7;
        vz = dir.z * speed * (0.3 + R()) + (R() - 0.5) * speed * 0.7;
        vy = R() * speed * 0.6;
      } else {
        const a = R() * 6.28, up = R();
        vx = Math.cos(a) * speed * (0.3 + R() * 0.7);
        vz = Math.sin(a) * speed * (0.3 + R() * 0.7);
        vy = up * speed * 0.8;
      }
      this.glow.add({ x, y, z, vx, vy, vz, drag: 1.5, lift: -18, floor: 0.04, life: life * (0.4 + R() * 0.8), s0: 0.14, s1: 0.05, c0: SPARK, c1: EMBER, a: 1, fadeIn: 0.01 });
    }
  }

  /* A low ring of dust rolling out along the ground. */
  dust(x, z, radius, n, color = DUST, life = 2.2) {
    const R = Math.random;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.28 + R() * 0.4, sp = radius * (0.8 + R() * 0.8);
      this.smokes.add({
        x: x + Math.cos(a) * 0.4, y: 0.4 + R() * 0.3, z: z + Math.sin(a) * 0.4,
        vx: Math.cos(a) * sp, vy: 0.3 + R() * 0.6, vz: Math.sin(a) * sp,
        drag: 2.2, lift: 0.15, floor: 0.3, life: life * (0.7 + R() * 0.6),
        s0: 0.8 + R() * 0.6, s1: 2.6 + R() * 1.8, c0: color, a: 0.55, fadeIn: 0.05, grow: 1.4,
      });
    }
  }

  /* A cloud of dust over an area, for collapses. */
  dustCloud(x, z, w, d, rot, n, height = 3) {
    const R = Math.random, c = Math.cos(rot), s = Math.sin(rot);
    for (let i = 0; i < n; i++) {
      const lx = (R() - 0.5) * w, lz = (R() - 0.5) * d;
      const px = x + lx * c + lz * s, pz = z - lx * s + lz * c;
      this.smokes.add({
        x: px, y: 0.5 + R() * height, z: pz,
        vx: (R() - 0.5) * 6, vy: 0.5 + R() * 2, vz: (R() - 0.5) * 6,
        drag: 1.2, lift: 0.25, floor: 0.4, life: 3.5 + R() * 3,
        s0: 1.6 + R(), s1: 4.5 + R() * 3, c0: DUST, c1: SMOKE_LIGHT, a: 0.6, fadeIn: 0.08, grow: 1.5,
      });
    }
  }

  /* A puff where a bullet struck: grit off concrete and brick, sparks off metal. */
  impact(x, y, z, material, dir) {
    const back = { x: -dir.x, z: -dir.z };
    if (material === 'metal') {
      this.sparks(x, y, z, this.n(5), 6, 0.35, back);
    } else {
      const col = material === 'brick' ? rgb(0x9a6a52) : material === 'wood' ? rgb(0x8a6a44) : DUST;
      for (let i = 0; i < this.n(2); i++) {
        this.smokes.add({
          x, y, z, vx: back.x * 1.5 + (Math.random() - 0.5), vy: 0.6 + Math.random(), vz: back.z * 1.5 + (Math.random() - 0.5),
          drag: 3, lift: 0.2, life: 0.7 + Math.random() * 0.4, s0: 0.25, s1: 0.9, c0: col, a: 0.6, fadeIn: 0.02,
        });
      }
      if (Math.random() < 0.4) this.sparks(x, y, z, 1, 4, 0.2, back);
    }
  }

  ring(x, z, size, life, color = 0xffc890) {
    const r = this.rings.find((q) => q.t >= q.life) || this.rings[0];
    r.t = 0; r.life = life; r.size = size;
    r.mesh.material.color.setHex(color);
    r.mesh.position.x = x; r.mesh.position.z = z;
    r.mesh.visible = true;
  }

  /* One lick of flame, for something burning (a zombie set alight). */
  flame(x, y, z, size = 0.5) {
    const R = Math.random;
    this.glow.add({
      x, y, z, vx: (R() - 0.5) * 0.4, vy: 1.5 + R(), vz: (R() - 0.5) * 0.4,
      drag: 1.2, lift: 2, life: 0.35 + R() * 0.3, s0: size * (0.8 + R() * 0.5), s1: size * 0.25,
      c0: R() < 0.3 ? HOT : FIRE, c1: DEEP, colorSpeed: 1.4, a: 0.8, fadeIn: 0.05,
    });
  }

  /* The Shockwave power-up: a flash, two rings and dust rolling out along
     the ground. No fire. */
  shockwave(x, z, radius, color) {
    const c = rgb(color);
    this.glow.add({ x, y: 1, z, vx: 0, vy: 0, vz: 0, life: 0.18, s0: 2, s1: radius * 1.6, c0: c, a: 0.7, fadeIn: 0.01, fadePow: 1 });
    this.ring(x, z, radius * 2.4, 0.45, color);
    this.ring(x, z, radius * 1.4, 0.3, 0xffffff);
    this.dust(x, z, radius * 1.4, this.n(20), DUST, 1.4);
    this.sparks(x, 0.8, z, this.n(24), 12, 0.5);
  }

  /* ── Emitters: things that keep burning or smoking ────────────────────── */
  emit(opts) {
    const e = { rate: 10, life: 6, acc: 0, age: 0, ...opts };
    this.emitters.push(e);
    return e;
  }

  update(dt) {
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i];
      e.age += dt;
      if (e.age >= e.life || e.dead) { this.emitters.splice(i, 1); continue; }
      const src = e.follow;
      if (src && src.removed) { this.emitters.splice(i, 1); continue; }
      if (src && src.group) { e.x = src.x; e.z = src.z; e.y = (src.y || 0) + (e.dy || 0); }
      const fadeOut = Math.min(1, (e.life - e.age) / 1.5);
      e.acc += dt * e.rate * this.scale * fadeOut;
      while (e.acc >= 1) {
        e.acc -= 1;
        const R = Math.random;
        const jx = (R() - 0.5) * (e.spread || 0.6), jz = (R() - 0.5) * (e.spread || 0.6);
        if (e.kind === 'fire') {
          const sz = e.size || 1;
          this.glow.add({
            x: e.x + jx, y: e.y, z: e.z + jz, vx: (R() - 0.5) * 0.6, vy: 1.8 + R() * 1.8, vz: (R() - 0.5) * 0.6,
            drag: 1.4, lift: 2.4, life: 0.55 + R() * 0.45, s0: (0.9 + R() * 0.6) * sz, s1: (0.25 + R() * 0.25) * sz,
            c0: R() < 0.3 ? HOT : FIRE, c1: DEEP, colorSpeed: 1.3, a: 0.75, fadeIn: 0.12,
          });
          if (R() < 0.35) {
            this.smokes.add({
              x: e.x + jx, y: e.y + 0.8, z: e.z + jz, vx: (R() - 0.5) * 0.5, vy: 1.4 + R(), vz: (R() - 0.5) * 0.5,
              drag: 0.6, lift: 0.4, life: 2.5 + R() * 1.5, s0: 0.8 * (e.size || 1), s1: 2.8 * (e.size || 1),
              c0: SMOKE_DARK, c1: SMOKE_LIGHT, colorSpeed: 0.8, a: 0.55, fadeIn: 0.15,
            });
          }
        } else {
          this.smokes.add({
            x: e.x + jx, y: e.y, z: e.z + jz, vx: (R() - 0.5) * 0.4, vy: 1 + R() * 0.8, vz: (R() - 0.5) * 0.4,
            drag: 0.5, lift: 0.35, life: 2 + R() * 1.5, s0: 0.5 * (e.size || 1), s1: 2 * (e.size || 1),
            c0: e.color || SMOKE_LIGHT, c1: SMOKE_LIGHT, a: e.alpha || 0.45, fadeIn: 0.2,
          });
        }
      }
    }
    this.glow.update(dt);
    this.smokes.update(dt);
    for (const r of this.rings) {
      if (r.t >= r.life) continue;
      r.t += dt;
      const k = Math.min(1, r.t / r.life);
      r.mesh.scale.setScalar(0.5 + r.size * (1 - Math.pow(1 - k, 2.5)));
      r.mesh.material.opacity = 0.9 * (1 - k);
      if (k >= 1) r.mesh.visible = false;
    }
  }

  draw(fog) {
    this.glow.draw(fog);
    this.smokes.draw(fog);
  }
}
