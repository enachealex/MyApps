/* The game itself: one level at a time, from the barricade to the safe zone.
   Game owns the renderer, the scene and everything moving in it. It tells the
   UI what happened through `hooks` and never touches the DOM directly. */

import * as THREE from '../vendor/three.module.min.js';
import { WEAPONS, ZOMBIES, PICKUPS, ARMOR_ABSORB, levelSpec, weaponStats, playerStats } from './config.js';
import { save, weaponUps } from './save.js';
import { sfx, vibrate } from './audio.js';
import { buildLevel, resolveColliders, mulberry32, WALK_HALF, START_Z } from './world.js';
import {
  initTextures, sharedGeo, makeSurvivor, makeZombie, makeGun, FLASH_MAT, TEX,
} from './models.js';

const FOG = 0x0d1418;
const MAX_COINS = 500;
const MAX_BULLETS = 240;
const MAX_PARTS = 500;
const SPAWN_AHEAD = 50;          // zombies appear this far up the road, hidden in the fog
const START_PZ = 2;              // where the survivor stands when a level begins
const MAX_ALIVE = 90;

const TAU = Math.PI * 2;
const lerpAngle = (a, b, t) => {
  let d = ((b - a) % TAU + TAU * 1.5) % TAU - Math.PI;
  return a + d * t;
};
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();

export class Game {
  constructor(canvas, hooks) {
    this.hooks = hooks;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(FOG);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    initTextures();

    this.scene = new THREE.Scene();
    // Linear fog, re-fitted to the camera distance every frame (see
    // updateCamera) so the survivor is always clear and the road ahead fades.
    this.scene.fog = new THREE.Fog(FOG, 20, 60);
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 90);
    this.camPos = new THREE.Vector3(0, 12, 14);
    this.camLook = new THREE.Vector3(0, 0, -4);

    // Moonlight from above, plus the survivor's flashlight.
    this.scene.add(new THREE.HemisphereLight(0x8aa0c8, 0x2a2018, 1.25));
    const moon = new THREE.DirectionalLight(0xb0c4ff, 0.9);
    moon.position.set(-8, 20, 6);
    this.scene.add(moon);
    this.flashlight = new THREE.SpotLight(0xfff0d0, 70, 34, 0.6, 0.55, 1.2);
    this.flashTarget = new THREE.Object3D();
    this.flashlight.target = this.flashTarget;
    this.scene.add(this.flashlight, this.flashTarget);
    this.muzzleLight = new THREE.PointLight(0xffc070, 0, 10, 1.5);
    this.scene.add(this.muzzleLight);

    const geo = sharedGeo();
    this.coinMesh = new THREE.InstancedMesh(geo.coin, new THREE.MeshLambertMaterial({ color: 0xffc928, emissive: 0x7a5200 }), MAX_COINS);
    this.bulletMesh = new THREE.InstancedMesh(geo.tracer, new THREE.MeshBasicMaterial({
      color: 0xffe2a0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
    }), MAX_BULLETS);
    this.partMesh = new THREE.InstancedMesh(geo.particle, new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX_PARTS);
    for (let i = 0; i < MAX_PARTS; i++) this.partMesh.setColorAt(i, tmpColor.set(0xffffff));
    for (const m of [this.coinMesh, this.bulletMesh, this.partMesh]) {
      m.count = 0;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(m);
    }

    this.muzzleFlash = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({
      color: 0xffd080, map: TEX.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.muzzleFlash.visible = false;
    this.scene.add(this.muzzleFlash);

    this.survivor = makeSurvivor();
    this.scene.add(this.survivor.root);
    this.guns = {};
    for (const w of WEAPONS) {
      const g = makeGun(w.id);
      g.group.position.set(-0.2, 1.4, 0.32);
      g.group.visible = false;
      this.survivor.body.add(g.group);
      this.guns[w.id] = g;
    }

    this.level = null;
    this.zombies = [];
    this.coins = [];
    this.bullets = [];
    this.parts = [];
    this.state = 'menu';
    this.time = 0;
    this.quality = save.settings.quality;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /* ── Setup ───────────────────────────────────────────────────────────── */
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality === 'low' ? 1 : 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 68 : 52;
    this.camera.updateProjectionMatrix();
  }

  setQuality(q) {
    this.quality = q;
    this.resize();
  }

  clearLevel() {
    if (this.level) this.level.dispose();
    this.level = null;
    for (const z of this.zombies) this.scene.remove(z.model.root);
    this.zombies.length = 0;
    this.coins.length = 0;
    this.bullets.length = 0;
    this.parts.length = 0;
  }

  /* The menu shows level 1's street with a few zombies milling about. */
  showMenu() {
    this.clearLevel();
    this.state = 'menu';
    const spec = levelSpec(Math.max(1, save.level));
    this.spec = spec;
    this.level = buildLevel(this.scene, Math.max(1, save.level), spec);
    this.rng = mulberry32(7);
    this.player = this.makePlayer();
    this.player.z = -6;
    this.standUp();
    for (let i = 0; i < 9; i++) this.spawnZombie('walker', (this.rng() - 0.5) * 11, -10 - this.rng() * 22, { calm: true });
    this.syncSurvivor(0);
  }

  standUp() {
    this.survivor.root.visible = true;
    this.survivor.body.rotation.set(0, 0, 0);
    this.survivor.body.position.y = 0;
  }

  makePlayer() {
    const stats = playerStats(save.pup);
    const owned = WEAPONS.filter((w) => save.owned.includes(w.id));
    const loadout = owned.map((w) => ({ stats: weaponStats(w, weaponUps(w.id)), ammo: 0 }));
    for (const l of loadout) l.ammo = l.stats.mag;
    let wi = loadout.findIndex((l) => l.stats.id === save.equipped);
    if (wi < 0) wi = 0;
    return {
      x: 0, z: START_PZ, yaw: Math.PI, hp: stats.maxHp, maxHp: stats.maxHp, armor: 0, stats,
      loadout, wi, fireCd: 0, reloadT: 0, swapT: 0, kick: 0, walk: 0, moving: 0,
      target: null, hurtT: 0, deadT: 0,
    };
  }

  start(levelNum) {
    this.clearLevel();
    this.levelNum = levelNum;
    this.spec = levelSpec(levelNum);
    this.level = buildLevel(this.scene, levelNum, this.spec);
    this.rng = mulberry32(levelNum * 31 + 5);
    this.player = this.makePlayer();
    this.standUp();
    this.run = { kills: 0, coins: 0, bossDead: !this.spec.boss, boss: null, time: 0 };
    for (const s of this.level.coinSpots) this.addCoin(s.x, 0.55, s.z, 0, 0, 0, true);
    this.shake = 0;
    this.groanT = 2;
    this.state = 'playing';
    this.syncSurvivor(0);
    this.camPos.set(0, 30, 30);
    this.hooks.banner(this.spec.boss ? `Level ${levelNum} — boss ahead` : `Level ${levelNum}`, 'Reach the safe zone');
  }

  get weapon() { return this.player.loadout[this.player.wi]; }

  /* ── Spawning ───────────────────────────────────────────────────────── */
  spawnZombie(kind, x, z, { calm = false, alley = null, chase = false } = {}) {
    const t = ZOMBIES[kind];
    const spec = this.spec;
    const model = makeZombie(kind, this.rng, t.eyes);
    const scale = t.scale * (kind === 'walker' ? 0.92 + this.rng() * 0.16 : 1);
    model.root.scale.setScalar(scale);
    this.scene.add(model.root);
    const hp = t.hp * (calm && this.state === 'menu' ? 1 : spec.hpMult);
    const zb = {
      kind, t, model, x, z, yaw: Math.PI * (this.rng() * 2 - 1), scale,
      hp, maxHp: hp,
      speed: (t.speed[0] + this.rng() * (t.speed[1] - t.speed[0])) * spec.speedMult,
      damage: t.damage * spec.damageMult,
      radius: t.radius * (scale / t.scale),
      state: chase ? 'chase' : 'idle', attackT: 0, hitDone: false,
      wanderT: 0, wx: 0, wz: 0, kx: 0, kz: 0, flash: 0, phase: this.rng() * 10,
      dead: false, deadT: 0, emerging: !!alley, alley, calm,
      lean: 0.1 + this.rng() * 0.25, headTilt: (this.rng() - 0.5) * 0.6,
    };
    if (kind === 'boss') this.run.boss = zb;
    this.zombies.push(zb);
    return zb;
  }

  spawnHorde(h) {
    h.spawned = true;
    const sp = this.spec;
    if (h.boss) {
      this.spawnZombie('boss', 0, h.z - 3, { chase: true });
      this.hooks.banner('The boss is here', 'Put it down to open the safe zone');
      sfx.groan(0, true);
    }
    for (let i = 0; i < h.count; i++) {
      if (this.zombies.length >= MAX_ALIVE) break;
      let kind = 'walker';
      const r = this.rng();
      if (!h.calm) {
        if (r < sp.bruteChance) kind = 'brute';
        else if (r < sp.bruteChance + sp.runnerChance) kind = 'runner';
      }
      if (h.alley) {
        const a = h.alley;
        this.spawnZombie(kind, a.x + a.side * this.rng() * 2.5, a.z + (this.rng() - 0.5) * 2, { alley: a, chase: true });
      } else {
        const p = { x: (this.rng() - 0.5) * 12.5, z: h.z + (this.rng() - 0.5) * 9 };
        resolveColliders(this.level.colliders, p, 0.6);
        this.spawnZombie(kind, p.x, p.z, { calm: h.calm });
      }
    }
    if (h.alley) this.hooks.banner('Ambush!', null, 1200);
  }

  addCoin(x, y, z, vx, vy, vz, placed = false) {
    if (this.coins.length >= MAX_COINS) return;
    this.coins.push({ x, y, z, vx, vy, vz, spin: this.rng() * TAU, placed, pull: false, age: 0 });
  }

  burst(x, y, z, n, color, { speed = 3, up = 2, size = 0.09, life = 0.6, gravity = 14 } = {}) {
    for (let i = 0; i < n && this.parts.length < MAX_PARTS; i++) {
      const a = this.rng() * TAU, s = speed * (0.4 + this.rng() * 0.8);
      this.parts.push({
        x, y, z, vx: Math.cos(a) * s, vy: up * (0.3 + this.rng()), vz: Math.sin(a) * s,
        life: life * (0.6 + this.rng() * 0.6), max: life, size: size * (0.6 + this.rng() * 0.8), color, gravity,
      });
    }
  }

  /* ── Frame ───────────────────────────────────────────────────────────── */
  update(dt, input) {
    this.time += dt;
    const p = this.player;
    if (this.level) this.level.animate(this.time);

    if (this.state === 'playing') {
      this.run.time += dt;
      this.updatePlayer(dt, input.move);
      this.updateHordes();
    } else if (this.state === 'dying') {
      p.deadT += dt;
      const k = Math.min(p.deadT / 0.6, 1);
      this.survivor.body.rotation.x = -Math.PI / 2 * (k * k);
      this.survivor.body.position.y = 0.15 * k;
      if (p.deadT > 1.6 && !p.reported) { p.reported = true; this.finish(false); }
    } else if (this.state === 'won') {
      p.deadT += dt;
      if (p.deadT > 0.9 && !p.reported) { p.reported = true; this.finish(true); }
    }

    if (this.state !== 'paused') {
      this.updateZombies(dt);
      this.updateBullets(dt);
      this.updateCoins(dt);
      this.updateItems(dt);
      this.updateParticles(dt);
    }
    this.updateCamera(dt);
    this.syncSurvivor(dt);
    this.updateFx(dt);
    if (this.state === 'playing') this.hooks.hud(this.hudState());
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /* ── Player ─────────────────────────────────────────────────────────── */
  updatePlayer(dt, mv) {
    const p = this.player;
    const L = this.level;
    const len = Math.hypot(mv.x, mv.z);
    p.moving = len;
    p.x += mv.x * p.stats.speed * dt;
    p.z += mv.z * p.stats.speed * dt;
    // Zombies are solid: a crowd blocks the road until you shoot a way
    // through or go round. Bigger ones shove you harder.
    for (const z of this.zombies) {
      if (z.dead) continue;
      const dx = p.x - z.x, dz = p.z - z.z;
      const min = z.radius + p.stats.radius;
      if (Math.abs(dx) > min || Math.abs(dz) > min) continue;
      const d = Math.hypot(dx, dz);
      if (d < min && d > 1e-4) {
        const share = z.scale > 1.2 ? 0.9 : 0.65;
        const push = min - d;
        p.x += (dx / d) * push * share;
        p.z += (dz / d) * push * share;
        z.x -= (dx / d) * push * (1 - share);
        z.z -= (dz / d) * push * (1 - share);
      }
    }
    resolveColliders(L.colliders, p, p.stats.radius);
    p.x = Math.max(-WALK_HALF, Math.min(WALK_HALF, p.x));
    p.z = Math.max(L.goalZ - 3.5, Math.min(START_Z, p.z));
    p.walk += len * dt * 11;

    // Auto-aim: the nearest zombie in range, preferring ones up the road.
    const w = this.weapon;
    const range = w.stats.range;
    let best = null, bestScore = Infinity;
    for (const z of this.zombies) {
      if (z.dead) continue;
      const dx = z.x - p.x, dz = z.z - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > range * range) continue;
      const score = Math.sqrt(d2) + (dz > 1 ? 4 : 0) + (z === p.target ? -1.5 : 0);
      if (score < bestScore) { bestScore = score; best = z; }
    }
    p.target = best;

    let desired = p.yaw;
    if (best) desired = Math.atan2(best.x - p.x, best.z - p.z);
    else if (len > 0.05) desired = Math.atan2(mv.x, mv.z);
    p.yaw = lerpAngle(p.yaw, desired, damp(best ? 22 : 12, dt));

    // Weapon
    p.fireCd = Math.max(p.fireCd - dt, -0.05);
    p.kick = Math.max(0, p.kick - dt * 9);
    if (p.swapT > 0) p.swapT -= dt;
    if (p.reloadT > 0) {
      p.reloadT -= dt;
      if (p.reloadT <= 0) { w.ammo = w.stats.mag; sfx.reload(); }
    } else if (best && w.ammo > 0 && p.fireCd <= 0 && p.swapT <= 0) {
      const off = Math.abs(lerpAngle(0, desired - p.yaw, 1));
      if (off < 0.3) this.fire();
    }
    if (p.hurtT > 0) p.hurtT -= dt;

    // Reached the safe zone?
    if (p.z < L.goalZ + 2.2 && Math.abs(p.x) < 3.4) {
      if (this.run.bossDead) {
        this.state = 'won';
        p.deadT = 0;
        p.target = null;
        sfx.win();
        vibrate([30, 40, 30], save.settings.haptics);
      } else if (!this.bossNagT || this.time - this.bossNagT > 4) {
        this.bossNagT = this.time;
        this.hooks.banner('Not yet', 'Kill the boss first', 1500);
      }
    }
  }

  fire() {
    const p = this.player;
    const w = this.weapon;
    const s = w.stats;
    if (p.fireCd < 0) p.fireCd = 0;
    p.fireCd += 1 / s.fireRate;
    w.ammo--;
    const gun = this.guns[s.id];
    const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
    const reach = 0.32 + gun.len;
    const mx = p.x + sin * reach - 0.2 * cos;
    const mz = p.z + cos * reach + 0.2 * sin;
    for (let i = 0; i < s.pellets; i++) {
      if (this.bullets.length >= MAX_BULLETS) break;
      const a = p.yaw + (this.rng() * 2 - 1) * s.spread;
      const speed = 62 + this.rng() * 8;
      this.bullets.push({
        x: mx, z: mz, dx: Math.sin(a), dz: Math.cos(a), speed, life: s.range / speed + 0.05,
        damage: s.damage, pierce: s.pierce, knock: s.knockback, hits: null,
      });
    }
    this.muzzleLight.position.set(mx, 1.5, mz);
    this.muzzleLight.intensity = 28;
    this.muzzleFlash.position.set(mx, 1.4, mz);
    this.muzzleFlash.visible = true;
    this.muzzleFlash.rotation.set(-Math.PI / 2, 0, this.rng() * TAU);
    this.muzzleFlash.scale.setScalar(s.pellets > 1 ? 1.5 : 0.8 + this.rng() * 0.4);
    this.flashT = 0.045;
    p.kick = 1;
    this.shake = Math.max(this.shake, s.shake);
    sfx.shot(s.id);
    if (w.ammo <= 0) this.reload();
  }

  reload() {
    const p = this.player, w = this.weapon;
    if (p.reloadT > 0 || w.ammo >= w.stats.mag || this.state !== 'playing') return;
    p.reloadT = w.stats.reload;
    sfx.reload();
  }

  swapWeapon(dir = 1) {
    const p = this.player;
    if (this.state !== 'playing' || p.loadout.length < 2) return;
    p.wi = (p.wi + dir + p.loadout.length) % p.loadout.length;
    p.reloadT = 0;
    p.swapT = 0.25;
    if (this.weapon.ammo <= 0) this.reload();
    sfx.swap();
  }

  hurtPlayer(dmg, fromX, fromZ) {
    const p = this.player;
    if (this.state !== 'playing') return;
    if (p.armor > 0) {
      const soak = Math.min(p.armor, dmg * ARMOR_ABSORB);
      p.armor -= soak;
      dmg -= soak;
    }
    p.hp -= dmg;
    p.hurtT = 0.35;
    this.shake = Math.max(this.shake, 0.35);
    this.hooks.hurt();
    sfx.hurt();
    vibrate(45, save.settings.haptics);
    this.burst(p.x, 1.3, p.z, 6, 0x8a0d0d, { speed: 2.5 });
    // a shove away from the attacker
    const dx = p.x - fromX, dz = p.z - fromZ, l = Math.hypot(dx, dz) || 1;
    p.x += (dx / l) * 0.35;
    p.z += (dz / l) * 0.35;
    if (p.hp <= 0) {
      p.hp = 0;
      this.state = 'dying';
      p.deadT = 0;
      sfx.lose();
    }
  }

  syncSurvivor(dt) {
    const p = this.player;
    if (!p) return;
    const m = this.survivor;
    m.root.position.set(p.x, 0, p.z);
    m.root.rotation.y = p.yaw;
    for (const id in this.guns) this.guns[id].group.visible = id === this.weapon.stats.id;
    const gun = this.guns[this.weapon.stats.id].group;
    gun.position.z = 0.32 - p.kick * 0.09;
    const sw = Math.sin(p.walk) * 0.7 * Math.min(p.moving * 1.5, 1);
    m.legL.rotation.x = sw;
    m.legR.rotation.x = -sw;
    m.body.position.y = this.state === 'dying' ? m.body.position.y : Math.abs(Math.cos(p.walk)) * 0.06 * p.moving;
    const reloading = p.reloadT > 0;
    const aim = -Math.PI / 2 + p.kick * 0.18 + (reloading ? 0.6 : 0);
    m.armR.rotation.set(aim, 0, 0.3);
    m.armL.rotation.set(aim + (reloading ? Math.sin(this.time * 18) * 0.3 : 0), 0, -0.62);
    m.head.rotation.y = 0;
  }

  /* ── Zombies ────────────────────────────────────────────────────────── */
  updateHordes() {
    const pz = this.player.z;
    for (const h of this.level.hordes) {
      if (!h.spawned && h.z > pz - SPAWN_AHEAD) this.spawnHorde(h);
    }
  }

  updateZombies(dt) {
    const p = this.player;
    const playing = this.state === 'playing';
    const zs = this.zombies;
    const cols = this.level.colliders;

    for (let i = zs.length - 1; i >= 0; i--) {
      const z = zs[i];
      const m = z.model;
      if (z.dead) {
        z.deadT += dt;
        const k = Math.min(z.deadT / 0.45, 1);
        m.body.rotation.x = -Math.PI / 2 * k * k;
        m.body.position.y = 0.12 * k;
        m.armL.rotation.x = m.armR.rotation.x = -Math.PI / 2 - k * 0.6;
        z.x += z.kx * dt; z.z += z.kz * dt;
        z.kx *= 1 - damp(6, dt); z.kz *= 1 - damp(6, dt);
        if (z.deadT > 3) m.root.position.y -= dt * 0.5;
        m.root.position.x = z.x; m.root.position.z = z.z;
        if (z.deadT > 4.5) {
          this.scene.remove(m.root);
          zs.splice(i, 1);
        }
        continue;
      }

      const dx = p.x - z.x, dz = p.z - z.z;
      const dist = Math.hypot(dx, dz);
      let vx = 0, vz = 0, faceYaw = null;

      if (z.state === 'idle') {
        z.wanderT -= dt;
        if (z.wanderT <= 0) {
          z.wanderT = 1.5 + this.rng() * 3;
          const a = this.rng() * TAU, go = this.rng() < 0.7;
          z.wx = go ? Math.sin(a) : 0; z.wz = go ? Math.cos(a) : 0;
        }
        vx = z.wx * z.speed * 0.35; vz = z.wz * z.speed * 0.35;
        if (vx || vz) faceYaw = Math.atan2(vx, vz);
        if (playing && dist < z.t.aggro) {
          z.state = 'chase';
          if (this.rng() < 0.4) sfx.groan(this.pan(z.x), z.kind === 'brute' || z.kind === 'boss');
        }
      } else if (z.state === 'chase') {
        if (!playing) { z.state = 'idle'; }
        else {
          const reach = z.t.reach * (z.scale / z.t.scale) + p.stats.radius;
          if (dist < reach) { z.state = 'attack'; z.attackT = 0; z.hitDone = false; }
          vx = (dx / dist) * z.speed; vz = (dz / dist) * z.speed;
          faceYaw = Math.atan2(dx, dz);
        }
      } else if (z.state === 'attack') {
        z.attackT += dt;
        faceYaw = Math.atan2(dx, dz);
        const period = 1 / z.t.attackRate;
        const windup = Math.min(0.42, period * 0.5);
        if (!z.hitDone && z.attackT >= windup) {
          z.hitDone = true;
          const reach = z.t.reach * (z.scale / z.t.scale) + p.stats.radius + 0.35;
          if (dist < reach && playing) {
            if (z.kind === 'boss') { sfx.slam(); this.shake = Math.max(this.shake, 0.6); }
            this.hurtPlayer(z.damage, z.x, z.z);
          }
        }
        if (z.attackT >= period) z.state = playing ? 'chase' : 'idle';
      }

      // Keep zombies from piling into one spot.
      for (let j = 0; j < zs.length; j++) {
        const o = zs[j];
        if (o === z || o.dead) continue;
        const ox = z.x - o.x, oz = z.z - o.z;
        const min = z.radius + o.radius;
        if (Math.abs(ox) > min || Math.abs(oz) > min) continue;
        const d2 = ox * ox + oz * oz;
        if (d2 < min * min && d2 > 1e-6) {
          const d = Math.sqrt(d2), push = (min - d) * 0.5;
          z.x += (ox / d) * push; z.z += (oz / d) * push;
        }
      }

      z.x += (vx + z.kx) * dt;
      z.z += (vz + z.kz) * dt;
      z.kx *= 1 - damp(9, dt); z.kz *= 1 - damp(9, dt);
      resolveColliders(cols, z, z.radius);
      if (z.emerging) { if (Math.abs(z.x) < WALK_HALF - 0.3) z.emerging = false; }
      else z.x = Math.max(-WALK_HALF, Math.min(WALK_HALF, z.x));
      if (z.z > START_Z) z.z = START_Z;
      // Zombies can't walk through the survivor (the survivor's side of
      // this is in updatePlayer).
      if (playing && dist < z.radius + p.stats.radius && dist > 1e-4) {
        const push = (z.radius + p.stats.radius - dist) * 0.5;
        z.x -= (dx / dist) * push; z.z -= (dz / dist) * push;
      }

      if (faceYaw !== null) z.yaw = lerpAngle(z.yaw, faceYaw, damp(z.state === 'idle' ? 3 : 8, dt));

      // Animation: legs shuffle, arms reach, heavier lurch for big ones.
      const moveSpeed = Math.hypot(vx, vz);
      z.phase += dt * (1.2 + moveSpeed * 2.2) / (z.scale / z.t.scale);
      const sw = Math.sin(z.phase) * Math.min(0.15 + moveSpeed * 0.18, 0.75);
      m.legL.rotation.x = sw; m.legR.rotation.x = -sw;
      m.body.rotation.x = z.lean + (z.kind === 'runner' ? 0.25 : 0);
      m.body.rotation.z = Math.sin(z.phase * 0.5) * 0.06;
      m.body.position.y = Math.abs(Math.cos(z.phase)) * 0.05;
      m.head.rotation.z = z.headTilt + Math.sin(z.phase * 0.7) * 0.1;
      let armX = -Math.PI / 2 + 0.25 + Math.sin(z.phase * 1.3) * 0.12;
      if (z.state === 'attack') {
        const k = z.attackT / Math.min(0.42, 0.5 / z.t.attackRate);
        armX = k < 1 ? -Math.PI / 2 - 0.9 * k : -Math.PI / 2 + 0.5;
      }
      m.armL.rotation.x = armX; m.armR.rotation.x = armX + Math.sin(z.phase) * 0.15;

      if (z.flash > 0) {
        z.flash -= dt;
        if (z.flash <= 0) for (const mesh of m.meshes) mesh.material = mesh.userData.mat;
      }

      m.root.position.set(z.x, 0, z.z);
      m.root.rotation.y = z.yaw;
    }

    // An occasional moan from somewhere close.
    if (playing) {
      this.groanT -= dt;
      if (this.groanT <= 0) {
        this.groanT = 2.5 + this.rng() * 4;
        const near = zs.find((z) => !z.dead && z.state !== 'idle' && Math.abs(z.z - p.z) < 18);
        if (near) sfx.groan(this.pan(near.x), near.kind === 'brute' || near.kind === 'boss');
      }
    }
  }

  pan(x) { return (x - this.player.x) / 10; }

  damageZombie(z, dmg, dx, dz, knock) {
    z.hp -= dmg;
    if (z.state === 'idle') z.state = 'chase';
    const k = knock / (z.scale * z.scale);
    z.kx += dx * k * 2.2; z.kz += dz * k * 2.2;
    if (z.flash <= 0) for (const mesh of z.model.meshes) mesh.material = FLASH_MAT;
    z.flash = 0.07;
    this.burst(z.x, 1.2 * z.scale, z.z, 3, 0x6e0b0b, { speed: 2.5, size: 0.08 });
    sfx.hit(this.pan(z.x));
    if (z.hp <= 0) this.killZombie(z, dx, dz);
  }

  killZombie(z, dx, dz) {
    z.dead = true;
    z.deadT = 0;
    z.yaw = Math.atan2(-dx, -dz);       // fall away from the shot
    z.model.root.rotation.y = z.yaw;
    for (const mesh of z.model.meshes) mesh.material = mesh.userData.mat;
    z.flash = 0;
    this.burst(z.x, 1.1 * z.scale, z.z, 10 + z.scale * 6, 0x5a0909, { speed: 3.5 * z.scale, size: 0.11 * z.scale });
    sfx.die(this.pan(z.x));
    this.run.kills++;
    const n = z.t.coins + (this.rng() < 0.3 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const a = this.rng() * TAU, s = 1.5 + this.rng() * 2.5;
      this.addCoin(z.x, 1, z.z, Math.cos(a) * s, 4 + this.rng() * 3, Math.sin(a) * s);
    }
    if (z.kind === 'boss') {
      this.run.bossDead = true;
      this.shake = 0.8;
      this.hooks.banner('Boss down!', 'The safe zone is open');
      sfx.slam();
    }
    if ((z.kind === 'brute' && this.rng() < 0.3) || z.kind === 'boss') this.level.dropItem(z.kind === 'boss' ? 'armor' : 'health', z.x, z.z);
  }

  /* ── Bullets ────────────────────────────────────────────────────────── */
  updateBullets(dt) {
    const zs = this.zombies;
    const bs = this.bullets;
    for (let i = bs.length - 1; i >= 0; i--) {
      const b = bs[i];
      const step = b.speed * dt;
      let remaining = step;
      let alive = true;
      // Sweep the segment so fast bullets never skip a zombie.
      while (alive && remaining > 0) {
        let hit = null, hitT = remaining;
        for (const z of zs) {
          if (z.dead || (b.hits && b.hits.includes(z))) continue;
          const ox = z.x - b.x, oz = z.z - b.z;
          const t = ox * b.dx + oz * b.dz;
          if (t < -z.radius || t > remaining + z.radius) continue;
          const px = ox - b.dx * t, pz = oz - b.dz * t;
          const r = z.radius + 0.12;
          if (px * px + pz * pz < r * r) {
            const tt = Math.max(0, t - Math.sqrt(r * r - (px * px + pz * pz)));
            if (tt < hitT) { hitT = tt; hit = z; }
          }
        }
        if (!hit) { b.x += b.dx * remaining; b.z += b.dz * remaining; break; }
        b.x += b.dx * hitT; b.z += b.dz * hitT;
        remaining -= hitT;
        this.damageZombie(hit, b.damage, b.dx, b.dz, b.knock);
        if (b.pierce > 0) { b.pierce--; (b.hits || (b.hits = [])).push(hit); }
        else alive = false;
      }
      b.life -= dt;
      if (!alive || b.life <= 0) bs.splice(i, 1);
    }
  }

  /* ── Coins & items ──────────────────────────────────────────────────── */
  updateCoins(dt) {
    const p = this.player;
    const cs = this.coins;
    const playing = this.state === 'playing';
    const mag = p.stats.magnet;
    for (let i = cs.length - 1; i >= 0; i--) {
      const c = cs[i];
      c.age += dt;
      c.spin += dt * 4;
      if (!c.placed) {
        c.vy -= 22 * dt;
        c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
        if (c.y < 0.35) { c.y = 0.35; c.vy *= -0.35; c.vx *= 0.6; c.vz *= 0.6; if (Math.abs(c.vy) < 0.8) c.placed = true; }
      }
      if (!playing) continue;
      const dx = p.x - c.x, dz = p.z - c.z;
      const d = Math.hypot(dx, dz);
      if (!c.pull && d < mag && c.age > 0.35) c.pull = true;
      if (c.pull) {
        const s = 9 + (mag - Math.min(d, mag)) * 4;
        c.x += (dx / (d || 1)) * s * dt;
        c.z += (dz / (d || 1)) * s * dt;
        c.y += (1.1 - c.y) * damp(8, dt);
      }
      if (d < 0.7) {
        cs.splice(i, 1);
        this.run.coins++;
        sfx.coin();
      }
    }
  }

  updateItems(dt) {
    const p = this.player;
    for (const it of this.level.items) {
      if (it.taken) continue;
      it.obj.rotation.y += dt * 1.6;
      it.obj.position.y = 0.15 + Math.sin(this.time * 3 + it.x) * 0.1;
      if (this.state !== 'playing') continue;
      if (Math.hypot(p.x - it.x, p.z - it.z) < 1.1) {
        if (it.kind === 'health' && p.hp >= p.maxHp) continue;
        if (it.kind === 'armor' && p.armor >= PICKUPS.maxArmor) continue;
        it.taken = true;
        it.obj.visible = false;
        it.decal.visible = false;
        if (it.kind === 'health') {
          p.hp = Math.min(p.maxHp, p.hp + PICKUPS.health);
          this.hooks.toast(`+${PICKUPS.health} health`, 'heal');
        } else {
          p.armor = Math.min(PICKUPS.maxArmor, p.armor + PICKUPS.armor);
          this.hooks.toast(`+${PICKUPS.armor} armor`, 'armor');
        }
        sfx.pickup();
        this.burst(it.x, 0.6, it.z, 12, it.kind === 'health' ? 0x6dff8a : 0x7ac8ff, { speed: 2, up: 4, gravity: 4, life: 0.8 });
      }
    }
  }

  /* ── Particles, camera, effects ─────────────────────────────────────── */
  updateParticles(dt) {
    const ps = this.parts;
    for (let i = ps.length - 1; i >= 0; i--) {
      const q = ps[i];
      q.life -= dt;
      if (q.life <= 0) { ps.splice(i, 1); continue; }
      q.vy -= q.gravity * dt;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      if (q.y < 0.03) { q.y = 0.03; q.vy = 0; q.vx *= 0.8; q.vz *= 0.8; }
    }
  }

  updateCamera(dt) {
    const p = this.player;
    if (!p) return;
    const aspect = this.camera.aspect;
    const tanH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * aspect;
    let dist = Math.max(13, Math.min(20, 5.8 / tanH));
    let lookAhead = 4;
    if (this.state === 'menu') {
      dist = 14;
      lookAhead = 3;               // puts the survivor just above the menu buttons
      p.yaw = Math.PI;
    }
    this.scene.fog.near = dist * 0.85;
    this.scene.fog.far = dist + 36;
    const el = 0.92;
    const tx = p.x * 0.55;
    const tz = p.z - lookAhead;
    this.camLook.x += (tx - this.camLook.x) * damp(5, dt);
    this.camLook.z += (tz - this.camLook.z) * damp(5, dt);
    this.camLook.y = 0.8;
    const wantX = tx, wantY = Math.sin(el) * dist, wantZ = tz + Math.cos(el) * dist + lookAhead * 0.4;
    const k = damp(this.state === 'playing' ? 4.5 : 2, dt);
    this.camPos.x += (wantX - this.camPos.x) * k;
    this.camPos.y += (wantY - this.camPos.y) * k;
    this.camPos.z += (wantZ - this.camPos.z) * k;
    this.camera.position.copy(this.camPos);
    if (this.shake > 0) {
      const s = this.shake * 0.35;
      this.camera.position.x += (this.rng() - 0.5) * s;
      this.camera.position.y += (this.rng() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 2.2);
    }
    if (this.state === 'menu') this.camera.position.x += Math.sin(this.time * 0.15) * 2;
    this.camera.lookAt(this.camLook);
  }

  updateFx(dt) {
    const p = this.player;
    // Flashlight follows the survivor's aim.
    const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
    this.flashlight.position.set(p.x + sin * 0.3, 2.3, p.z + cos * 0.3);
    this.flashTarget.position.set(p.x + sin * 9, 0, p.z + cos * 9);
    this.flashlight.visible = this.state !== 'dying';

    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) { this.muzzleLight.intensity = 0; this.muzzleFlash.visible = false; }
    }

    // Instanced coins
    const cs = this.coins;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      dummy.position.set(c.x, c.y + (c.placed && !c.pull ? Math.sin(this.time * 3 + c.x + c.z) * 0.08 : 0), c.z);
      dummy.rotation.set(0, c.spin, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      this.coinMesh.setMatrixAt(i, dummy.matrix);
    }
    this.coinMesh.count = cs.length;
    this.coinMesh.instanceMatrix.needsUpdate = true;

    // Tracers
    const bs = this.bullets;
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i];
      dummy.position.set(b.x - b.dx * 0.5, 1.4, b.z - b.dz * 0.5);
      dummy.rotation.set(0, Math.atan2(b.dx, b.dz), 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      this.bulletMesh.setMatrixAt(i, dummy.matrix);
    }
    this.bulletMesh.count = bs.length;
    this.bulletMesh.instanceMatrix.needsUpdate = true;

    // Particles
    const ps = this.parts;
    for (let i = 0; i < ps.length; i++) {
      const q = ps[i];
      const s = q.size * Math.min(1, q.life / q.max * 2);
      dummy.position.set(q.x, q.y, q.z);
      dummy.rotation.set(q.vx, q.vz, 0);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      this.partMesh.setMatrixAt(i, dummy.matrix);
      this.partMesh.setColorAt(i, tmpColor.set(q.color));
    }
    this.partMesh.count = ps.length;
    this.partMesh.instanceMatrix.needsUpdate = true;
    if (this.partMesh.instanceColor) this.partMesh.instanceColor.needsUpdate = true;
  }

  /* ── Results & HUD ──────────────────────────────────────────────────── */
  finish(won) {
    const r = this.run;
    const bonus = won ? this.spec.clearBonus : 0;
    const result = { won, level: this.levelNum, kills: r.kills, coins: r.coins, bonus, total: r.coins + bonus, time: r.time };
    save.coins += result.total;
    save.kills += r.kills;
    if (won) {
      save.unlocked = Math.max(save.unlocked, this.levelNum + 1);
      save.level = this.levelNum + 1;
    }
    this.hooks.finish(result);
  }

  hudState() {
    const p = this.player, w = this.weapon, r = this.run;
    const L = this.level;
    const boss = r.boss && !r.boss.dead ? r.boss.hp / r.boss.maxHp : null;
    return {
      level: this.levelNum,
      progress: Math.max(0, Math.min(1, (START_PZ - p.z) / (START_PZ - L.goalZ))),
      coins: save.coins + r.coins,
      hp: p.hp, maxHp: p.maxHp, armor: p.armor, maxArmor: PICKUPS.maxArmor,
      weapon: w.stats.name, ammo: w.ammo, mag: w.stats.mag,
      reload: p.reloadT > 0 ? 1 - p.reloadT / w.stats.reload : null,
      next: p.loadout.length > 1 ? p.loadout[(p.wi + 1) % p.loadout.length].stats.name : null,
      kills: r.kills, boss, hurt: p.hurtT > 0, low: p.hp / p.maxHp < 0.3,
    };
  }

  pause() { if (this.state === 'playing') this.state = 'paused'; }
  resume() { if (this.state === 'paused') this.state = 'playing'; }
}
