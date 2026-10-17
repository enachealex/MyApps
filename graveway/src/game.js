/* The game: one endless run up the dead road.
   Game owns the renderer, the scene and everything moving in it, and wires
   the parts together:
     World     (world.js)     streams the street in chunks
     Director  (director.js)  spawns zombies by distance and time
     NavGrid   (nav.js)       zombie pathfinding, rebuilt as the street changes
     PropSystem(props.js)     destructible props, debris, rubble
     Weapon    (weapons.js)   the guns in your hands
   It tells the UI what happened through `hooks` and never touches the DOM. */

import * as THREE from '../vendor/three.module.min.js';
import {
  WEAPONS, ZOMBIES, PICKUPS, ARMOR_ABSORB, DIRECTOR, CHARACTERS, RUBBLE_SLOW, RUBBLE_SLOW_PLAYER,
  playerStats, stageScaling, characterDef,
} from './config.js';
import { save, weaponUps } from './save.js';
import { sfx, vibrate } from './audio.js';
import { World, resolveColliders, rayProps, mulberry32, WALK_HALF, START_PZ } from './world.js';
import { NavGrid } from './nav.js';
import { PropSystem } from './props.js';
import { Director } from './director.js';
import { Weapon } from './weapons.js';
import {
  initTextures, sharedGeo, makeSurvivor, makeZombie, makeGun, FLASH_MAT, TEX, scorchDecal, lambert,
} from './models.js';

const FOG = 0x0d1418;
const MAX_COINS = 500;
const MAX_BULLETS = 260;
const MAX_PARTS = 700;
const MAX_GRENADES = 24;
const GRAVITY = 20;

const TAU = Math.PI * 2;
const lerpAngle = (a, b, t) => {
  const d = ((b - a) % TAU + TAU * 1.5) % TAU - Math.PI;
  return a + d * t;
};
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();
const steerOut = { x: 0, z: 0 };

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

    // Moonlight from above, the survivor's flashlight, and two lights that
    // only switch on for muzzle flashes and explosions.
    this.scene.add(new THREE.HemisphereLight(0x8aa0c8, 0x2a2018, 1.25));
    const moon = new THREE.DirectionalLight(0xb0c4ff, 0.9);
    moon.position.set(-8, 20, 6);
    this.scene.add(moon);
    this.flashlight = new THREE.SpotLight(0xfff0d0, 70, 34, 0.6, 0.55, 1.2);
    this.flashTarget = new THREE.Object3D();
    this.flashlight.target = this.flashTarget;
    this.scene.add(this.flashlight, this.flashTarget);
    this.muzzleLight = new THREE.PointLight(0xffc070, 0, 10, 1.5);
    this.blastLight = new THREE.PointLight(0xff9040, 0, 16, 1.4);
    this.scene.add(this.muzzleLight, this.blastLight);

    const geo = sharedGeo();
    this.coinMesh = new THREE.InstancedMesh(geo.coin, new THREE.MeshLambertMaterial({ color: 0xffc928, emissive: 0x7a5200 }), MAX_COINS);
    this.bulletMesh = new THREE.InstancedMesh(geo.tracer, new THREE.MeshBasicMaterial({
      color: 0xffe2a0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
    }), MAX_BULLETS);
    this.partMesh = new THREE.InstancedMesh(geo.particle, new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX_PARTS);
    for (let i = 0; i < MAX_PARTS; i++) this.partMesh.setColorAt(i, tmpColor.set(0xffffff));
    this.grenadeMesh = new THREE.InstancedMesh(geo.grenade, lambert(0x4a5a2a, { emissive: 0x1a2a08 }), MAX_GRENADES);
    for (const m of [this.coinMesh, this.bulletMesh, this.partMesh, this.grenadeMesh]) {
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

    this.survivors = {};            // one model per character, built on first use
    this.surv = null;
    this.nav = new NavGrid();
    this.propSys = new PropSystem(this);
    this.director = new Director(this);
    this.world = null;
    this.zombies = [];
    this.coins = [];
    this.bullets = [];
    this.grenades = [];
    this.parts = [];
    this.pending = [];              // delayed explosions (barrel chain reactions)
    this.state = 'menu';
    this.time = 0;
    this.shake = 0;
    this.fps = 60;                  // smoothed, measured in main.js
    this.rng = mulberry32(7);
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

  /* Swaps the survivor model to a character from CHARACTERS. */
  setCharacter(id) {
    const c = characterDef(id);
    if (!this.survivors[c.id]) {
      const m = makeSurvivor(c.look);
      m.guns = {};
      for (const w of WEAPONS) {
        const g = makeGun(w.model);
        g.group.position.set(-0.2, 1.4, 0.32);
        g.group.visible = false;
        m.body.add(g.group);
        m.guns[w.id] = g;
      }
      this.survivors[c.id] = m;
    }
    if (this.surv) this.scene.remove(this.surv.root);
    this.surv = this.survivors[c.id];
    this.scene.add(this.surv.root);
    this.character = c;
    this.standUp();
  }

  standUp() {
    this.surv.root.visible = true;
    this.surv.body.rotation.set(0, 0, 0);
    this.surv.body.position.y = 0;
  }

  clearRun() {
    if (this.world) this.world.dispose();
    this.world = null;
    for (const z of this.zombies) this.scene.remove(z.model.root);
    this.zombies.length = 0;
    this.coins.length = 0;
    this.bullets.length = 0;
    this.grenades.length = 0;
    this.parts.length = 0;
    this.pending.length = 0;
    this.propSys.reset();
    this.run = null;
  }

  /* The menu shows the first stretch of road with a few zombies about. */
  showMenu() {
    this.clearRun();
    this.state = 'menu';
    this.rng = mulberry32(7);
    this.setCharacter(save.character);
    this.world = new World(this.scene, 7, START_PZ);
    this.player = this.makePlayer();
    this.player.z = -6;
    this.world.update(this.player.z, 0);
    for (let i = 0; i < 9; i++) this.spawnZombie('walker', (this.rng() - 0.5) * 11, -12 - this.rng() * 22, 0, { calm: true });
    this.syncSurvivor(0);
  }

  makePlayer() {
    const c = this.character;
    const stats = playerStats(c, save.pup);
    // Your survivor's own gun first, then everything bought in the Armory.
    const ids = [c.startingWeapon, ...WEAPONS.map((w) => w.id).filter((id) => id !== c.startingWeapon && save.owned.includes(id))];
    const weapons = ids.map((id) => new Weapon(id, weaponUps(id), c.perk));
    return {
      x: 0, z: START_PZ, yaw: Math.PI, hp: stats.maxHp, maxHp: stats.maxHp, armor: Math.min(PICKUPS.maxArmor, stats.startArmor), stats,
      weapons, wi: 0, swapT: 0, kick: 0, walk: 0, moving: 0, firing: false,
      target: null, hurtT: 0, deadT: 0, furthest: START_PZ, reported: false,
    };
  }

  start() {
    this.clearRun();
    this.setCharacter(save.character);
    const startAt = save.settings.startAt || 0;
    const startZ = START_PZ - startAt;
    this.seed = (Date.now() & 0xffff) ^ 0x5bd1;
    this.rng = mulberry32(this.seed);
    this.world = new World(this.scene, this.seed, startZ);
    this.world.onCoins = (spots) => { for (const s of spots) this.addCoin(s.x, 0.55, s.z, 0, 0, 0, true); };
    this.player = this.makePlayer();
    this.player.z = this.player.furthest = startZ;
    this.run = { kills: 0, coins: 0, bonus: 0, time: 0, boss: null, startAt, startZ };
    this.director.reset(startAt);
    this.nav.reset(startZ);
    this.world.update(startZ, this.time);
    this.shake = 0;
    this.groanT = 2;
    this.state = 'playing';
    this.standUp();
    this.syncSurvivor(0);
    this.camPos.set(0, 30, startZ + 30);
    this.hooks.banner(this.character.name, startAt ? `Starting at ${startAt} m` : 'Get as far up the road as you can');
  }

  get weapon() { return this.player.weapons[this.player.wi]; }

  /* Metres up the road: the furthest point reached this run. */
  get distance() { return Math.max(0, START_PZ - this.player.furthest); }

  get stage() { return Math.floor(this.distance / DIRECTOR.stageLength); }

  /* ── Spawning ───────────────────────────────────────────────────────── */
  spawnZombie(kind, x, z, stage, { calm = false, alley = null, chase = false } = {}) {
    const t = ZOMBIES[kind];
    const sc = stageScaling(stage);
    const model = makeZombie(kind, this.rng, t.eyes);
    const scale = t.scale * (kind === 'walker' ? 0.92 + this.rng() * 0.16 : 1);
    model.root.scale.setScalar(scale);
    this.scene.add(model.root);
    const hp = t.hp * sc.hpMult;
    const zb = {
      kind, t, model, x, z, yaw: Math.PI * (this.rng() * 2 - 1), scale, stage,
      hp, maxHp: hp,
      speed: (t.speed[0] + this.rng() * (t.speed[1] - t.speed[0])) * sc.speedMult,
      damage: t.damage * sc.damageMult,
      radius: t.radius * (scale / t.scale),
      state: chase ? 'chase' : 'idle', attackT: 0, hitDone: false, smash: null,
      wanderT: 0, wx: 0, wz: 0, kx: 0, kz: 0, flash: 0, phase: this.rng() * 10,
      dead: false, deadT: 0, emerging: !!alley, calm, losT: this.rng() * 0.3, los: false, stuck: false,
      lean: 0.1 + this.rng() * 0.25, headTilt: (this.rng() - 0.5) * 0.6,
    };
    this.zombies.push(zb);
    return zb;
  }

  alive() {
    let n = 0;
    for (const z of this.zombies) if (!z.dead) n++;
    return n;
  }

  /* Called by the Director. */
  spawnGroup(count, stage, { z = null, alley = null, behind = false } = {}) {
    const room = this.director.maxActive(stage) - this.alive();
    const n = Math.min(count, room);
    for (let i = 0; i < n; i++) {
      const kind = this.director.pickKind(stage);
      if (alley) {
        this.spawnZombie(kind, alley.x + alley.side * this.rng() * 2.5, alley.z + (this.rng() - 0.5) * 2, stage, { alley, chase: true });
      } else {
        const p = { x: (this.rng() - 0.5) * 12.5, z: z + (this.rng() - 0.5) * 8 };
        resolveColliders(this.world.props, p, 0.6);
        this.spawnZombie(kind, p.x, p.z, stage, { chase: behind });
      }
    }
    if (alley && n >= 3) this.hooks.banner('Ambush!', null, 1200);
  }

  spawnBoss() {
    const p = { x: 0, z: this.player.z - 38 };
    resolveColliders(this.world.props, p, 1.3);
    this.run.boss = this.spawnZombie('boss', p.x, p.z, this.stage, { chase: true });
    this.hooks.banner('Something big is coming', 'Put it down for a fat reward');
    sfx.groan(0, true);
  }

  onStage(stage) {
    const bonus = DIRECTOR.stageBonus(stage);
    this.run.bonus += bonus;
    this.hooks.banner(`Stage ${stage + 1}`, `${stage * DIRECTOR.stageLength} m · +${bonus} coins · they're getting tougher`, 1800);
    sfx.milestone();
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
    if (this.world && this.state !== 'paused') this.world.update(p.z, this.time);

    if (this.state === 'playing') {
      this.run.time += dt;
      this.updatePlayer(dt, input.move);
      this.director.update(dt, this.distance);
    } else if (this.state === 'dying') {
      p.deadT += dt;
      const k = Math.min(p.deadT / 0.6, 1);
      this.surv.body.rotation.x = -Math.PI / 2 * (k * k);
      this.surv.body.position.y = 0.15 * k;
      if (p.deadT > 1.6 && !p.reported) { p.reported = true; this.finish(); }
    }

    if (this.state !== 'paused') {
      const w = this.world;
      if (w.navDirty) { this.nav.dirty = true; w.navDirty = false; }
      if (this.state !== 'menu') this.nav.update(dt, p.x, p.z, w.props, w.rough);
      this.updatePending(dt);
      this.updateZombies(dt);
      this.updateBullets(dt);
      this.updateGrenades(dt);
      this.propSys.update(dt);
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
    const props = this.world.props;
    const len = Math.hypot(mv.x, mv.z);
    const slow = this.nav.isRough(p.x, p.z) ? RUBBLE_SLOW_PLAYER : 1;
    p.moving = len * slow;
    p.x += mv.x * p.stats.speed * slow * dt;
    p.z += mv.z * p.stats.speed * slow * dt;
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
    resolveColliders(props, p, p.stats.radius);
    p.x = Math.max(-WALK_HALF, Math.min(WALK_HALF, p.x));
    // No going back past the start barricade, or more than 20 m back down
    // the road (it's being torn down behind you).
    p.z = Math.min(p.z, this.run.startZ + 4, p.furthest + 20);
    p.furthest = Math.min(p.furthest, p.z);
    p.walk += len * slow * dt * 11;

    const w = this.weapon;
    const target = this.chooseTarget(w);
    p.target = target;

    let desired = p.yaw;
    if (target) desired = Math.atan2(target.x - p.x, target.z - p.z);
    else if (len > 0.05) desired = Math.atan2(mv.x, mv.z);
    p.yaw = lerpAngle(p.yaw, desired, damp(target ? 22 : 12, dt));

    p.kick = Math.max(0, p.kick - dt * 9);
    if (p.swapT > 0) p.swapT -= dt;
    p.firing = false;
    if (w.tick(dt, !!target)) sfx.reload();
    if (target && w.canFire() && p.swapT <= 0) {
      const off = Math.abs(lerpAngle(0, desired - p.yaw, 1));
      if (off < 0.3) { this.fire(target); p.firing = true; }
    }
    if (p.hurtT > 0) p.hurtT -= dt;
  }

  /* Auto-aim. The nearest zombie in range, preferring ones up the road and
     ones with a clear line of fire. Zombies behind a wreck you can't shoot
     through are skipped; behind something breakable, they're a last resort.
     An explosive barrel with a crowd round it beats any single zombie. */
  chooseTarget(w) {
    const p = this.player;
    const range = w.stats.range, minRange = w.stats.minRange || 0;
    const props = this.world.props;
    let best = null, bestScore = Infinity;
    for (const z of this.zombies) {
      if (z.dead) continue;
      const dx = z.x - p.x, dz = z.z - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > range * range || d2 < minRange * minRange) continue;
      const d = Math.sqrt(d2);
      let score = d + (dz > 1 ? 4 : 0) + (p.target && p.target.zombie === z ? -1.5 : 0);
      if (!w.explosive) {
        const hit = rayProps(props, p.x, p.z, dx / d, dz / d, d - z.radius);
        if (hit.prop) {
          if (hit.prop.hp === null) continue;
          score += 8;
        }
      }
      if (score < bestScore) { bestScore = score; best = z; }
    }
    // Barrels worth shooting: two or more zombies in the blast, and you clear of it.
    for (const b of props) {
      if (b.kind !== 'barrel' || b.destroyed) continue;
      const dx = b.x - p.x, dz = b.z - p.z, d = Math.hypot(dx, dz);
      const r = b.def.explodes.radius;
      if (d > range || d < r + 1) continue;
      let n = 0;
      for (const z of this.zombies) if (!z.dead && Math.hypot(z.x - b.x, z.z - b.z) < r) n++;
      if (n < 2) continue;
      const score = d - n * 3;
      if (score < bestScore) { bestScore = score; best = b; }
    }
    if (!best) return null;
    return best.kind === 'barrel' && best.def
      ? { x: best.x, z: best.z, prop: best, zombie: null }
      : { x: best.x, z: best.z, prop: null, zombie: best };
  }

  fire(target) {
    const p = this.player;
    const w = this.weapon;
    const s = w.stats;
    const emptied = w.consume();
    const gun = this.surv.guns[w.id];
    const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
    const reach = 0.32 + gun.len;
    const mx = p.x + sin * reach - 0.2 * cos;
    const mz = p.z + cos * reach + 0.2 * sin;
    if (w.explosive) {
      // Lob: fixed horizontal speed, vertical speed solved to land on target.
      const tx = target.x + (this.rng() - 0.5) * 2 * w.spread * 4, tz = target.z + (this.rng() - 0.5) * 2 * w.spread * 4;
      const dx = tx - mx, dz = tz - mz, d = Math.hypot(dx, dz);
      const speed = 15, t = Math.max(d / speed, 0.15);
      if (this.grenades.length < MAX_GRENADES) {
        this.grenades.push({
          x: mx, y: 1.45, z: mz, vx: dx / t, vy: (0 - 1.45 + 0.5 * GRAVITY * t * t) / t, vz: dz / t,
          life: t + 0.6, damage: s.damage, blast: s.blast, spin: 0,
        });
      }
    } else {
      for (let i = 0; i < s.pellets; i++) {
        if (this.bullets.length >= MAX_BULLETS) break;
        const a = p.yaw + (this.rng() * 2 - 1) * w.spread;
        const speed = 62 + this.rng() * 8;
        this.bullets.push({
          x: mx, z: mz, dx: Math.sin(a), dz: Math.cos(a), speed, life: s.range / speed + 0.05,
          damage: s.damage, pierce: s.pierce, knock: s.knockback, hits: null,
        });
      }
    }
    this.muzzleLight.position.set(mx, 1.5, mz);
    this.muzzleLight.intensity = 28;
    this.muzzleFlash.position.set(mx, 1.4, mz);
    this.muzzleFlash.visible = true;
    this.muzzleFlash.rotation.set(-Math.PI / 2, 0, this.rng() * TAU);
    this.muzzleFlash.scale.setScalar(s.pellets > 1 || w.explosive ? 1.5 : 0.8 + this.rng() * 0.4);
    this.flashT = 0.045;
    p.kick = 1;
    this.shake = Math.max(this.shake, s.shake);
    sfx.shot(w.def.model);
    if (emptied) this.reload();
  }

  reload() {
    if (this.state !== 'playing') return;
    if (this.weapon.startReload()) sfx.reload();
  }

  selectWeapon(i) {
    const p = this.player;
    if (this.state !== 'playing' || i === p.wi || !p.weapons[i]) return;
    this.weapon.cancelReload();
    p.wi = i;
    p.swapT = 0.25;
    if (this.weapon.ammo <= 0) this.reload();
    sfx.swap();
  }

  swapWeapon(dir = 1) {
    const n = this.player.weapons.length;
    if (n > 1) this.selectWeapon((this.player.wi + dir + n) % n);
  }

  hurtPlayer(dmg, fromX, fromZ, { blast = false } = {}) {
    const p = this.player;
    if (this.state !== 'playing') return;
    if (save.settings.god) dmg = 0;     // playtest tool: still flinch, never hurt
    if (blast) dmg *= 1 - p.stats.explosionResist;
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
    p.x += (dx / l) * (blast ? 0.8 : 0.35);
    p.z += (dz / l) * (blast ? 0.8 : 0.35);
    if (p.hp <= 0) {
      p.hp = 0;
      this.state = 'dying';
      p.deadT = 0;
      sfx.lose();
    }
  }

  syncSurvivor() {
    const p = this.player;
    if (!p) return;
    const m = this.surv;
    m.root.position.set(p.x, 0, p.z);
    m.root.rotation.y = p.yaw;
    const id = this.weapon.id;
    for (const k in m.guns) m.guns[k].group.visible = k === id;
    m.guns[id].group.position.z = 0.32 - p.kick * 0.09;
    const sw = Math.sin(p.walk) * 0.7 * Math.min(p.moving * 1.5, 1);
    m.legL.rotation.x = sw;
    m.legR.rotation.x = -sw;
    if (this.state !== 'dying') m.body.position.y = Math.abs(Math.cos(p.walk)) * 0.06 * p.moving;
    const reloading = this.weapon.reloading;
    const aim = -Math.PI / 2 + p.kick * 0.18 + (reloading ? 0.6 : 0);
    m.armR.rotation.set(aim, 0, 0.3);
    m.armL.rotation.set(aim + (reloading ? Math.sin(this.time * 18) * 0.3 : 0), 0, -0.62);
  }

  /* ── Zombies ────────────────────────────────────────────────────────── */
  updateZombies(dt) {
    const p = this.player;
    const playing = this.state === 'playing';
    const zs = this.zombies;
    const props = this.world.props;
    const nav = this.nav;

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
      // Far behind the survivor, off the built road: gone.
      if (z.z > p.z + 45 && z !== this.run?.boss) {
        this.scene.remove(m.root);
        zs.splice(i, 1);
        continue;
      }

      const dx = p.x - z.x, dz = p.z - z.z;
      const dist = Math.hypot(dx, dz) || 1e-4;
      let vx = 0, vz = 0, faceYaw = null;
      const slow = nav.isRough(z.x, z.z) ? RUBBLE_SLOW : 1;

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
          if (this.rng() < 0.4) sfx.groan(this.pan(z.x), z.t.smashes);
        }
      } else if (z.state === 'chase') {
        if (!playing) z.state = 'idle';
        else {
          const reach = z.t.reach * (z.scale / z.t.scale) + p.stats.radius;
          if (dist < reach) { z.state = 'attack'; z.attackT = 0; z.hitDone = false; }
          // Walk straight at you when nothing's in the way; otherwise follow
          // the flow field around the props.
          z.losT -= dt;
          if (z.losT <= 0) { z.losT = 0.25; z.los = dist < 14 && nav.clear(z.x, z.z, p.x, p.z); }
          let ux = dx / dist, uz = dz / dist;
          z.stuck = false;
          if (!z.los && !z.emerging) {
            const s = nav.steer(z.x, z.z, steerOut);
            if (s) { ux = s.x; uz = s.z; }
            else if (nav.cellOf(z.x, z.z) >= 0) z.stuck = true;    // no path: go straight and break through
          }
          vx = ux * z.speed * slow; vz = uz * z.speed * slow;
          faceYaw = Math.atan2(vx, vz);
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
      } else if (z.state === 'smash') {
        // Beating on a prop in the way.
        const pr = z.smash;
        z.attackT += dt;
        faceYaw = Math.atan2(pr.x - z.x, pr.z - z.z);
        const period = 1 / z.t.attackRate;
        if (!z.hitDone && z.attackT >= Math.min(0.42, period * 0.5)) {
          z.hitDone = true;
          this.propSys.damage(pr, z.damage * (z.t.smashes ? 3 : 1.5), pr.x - z.x, pr.z - z.z, 'smash');
          sfx.thunk();
        }
        if (z.attackT >= period) {
          z.attackT = 0; z.hitDone = false;
          if (pr.destroyed || !playing || dist < 2) { z.smash = null; z.state = playing ? 'chase' : 'idle'; }
        }
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
      const bumped = resolveColliders(props, z, z.radius);
      // Tanks beat down whatever they walk into; anyone with no way round
      // does the same. The big ones shove wrecks aside.
      if (bumped && z.state === 'chase' && (z.t.smashes || z.stuck)) {
        if (bumped.hp !== null) { z.state = 'smash'; z.smash = bumped; z.attackT = 0; z.hitDone = false; }
        else if (z.t.smashes && bumped.def.mass) {
          const shove = (z.kind === 'boss' ? 160 : 60) * dt / bumped.def.mass / (z.speed || 1);
          bumped.vx += vx * shove;
          bumped.vz += vz * shove;
          bumped.moving = true;
        }
      }
      if (z.emerging) { if (Math.abs(z.x) < WALK_HALF - 0.3) z.emerging = false; }
      else z.x = Math.max(-WALK_HALF, Math.min(WALK_HALF, z.x));
      if (this.run && z.z > this.run.startZ + 4.5) z.z = this.run.startZ + 4.5;
      // Zombies can't walk through the survivor (the survivor's side of
      // this is in updatePlayer).
      if (playing && dist < z.radius + p.stats.radius) {
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
      if (z.state === 'attack' || z.state === 'smash') {
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
        if (near) sfx.groan(this.pan(near.x), near.t.smashes);
      }
    }
  }

  pan(x) { return (x - this.player.x) / 10; }

  damageZombie(z, dmg, dx, dz, knock) {
    if (z.dead) return;
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
    if (this.run) this.run.kills++;
    const n = z.t.coins + (this.rng() < 0.3 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const a = this.rng() * TAU, s = 1.5 + this.rng() * 2.5;
      this.addCoin(z.x, 1, z.z, Math.cos(a) * s, 4 + this.rng() * 3, Math.sin(a) * s);
    }
    if (z.kind === 'boss') {
      this.shake = 0.8;
      this.hooks.banner('Boss down!', `+${z.t.coins} coins on the ground`);
      sfx.slam();
    }
    if ((z.kind === 'tank' && this.rng() < 0.3) || z.kind === 'boss') this.world.dropItem(z.kind === 'boss' ? 'armor' : 'health', z.x, z.z);
  }

  /* ── Bullets, grenades, explosions ───────────────────────────────────── */
  updateBullets(dt) {
    const zs = this.zombies;
    const bs = this.bullets;
    const props = this.world.props;
    for (let i = bs.length - 1; i >= 0; i--) {
      const b = bs[i];
      let remaining = b.speed * dt;
      let alive = true;
      // The first prop on this step's line stops the bullet there.
      const wall = rayProps(props, b.x, b.z, b.dx, b.dz, remaining);
      let toWall = wall.t;
      // Sweep the segment so fast bullets never skip a zombie.
      while (alive && remaining > 0) {
        let hit = null, hitT = Math.min(remaining, toWall);
        for (const z of zs) {
          if (z.dead || (b.hits && b.hits.includes(z))) continue;
          const ox = z.x - b.x, oz = z.z - b.z;
          const t = ox * b.dx + oz * b.dz;
          if (t < -z.radius || t > hitT + z.radius) continue;
          const px = ox - b.dx * t, pz = oz - b.dz * t;
          const r = z.radius + 0.12;
          if (px * px + pz * pz < r * r) {
            const tt = Math.max(0, t - Math.sqrt(r * r - (px * px + pz * pz)));
            if (tt < hitT) { hitT = tt; hit = z; }
          }
        }
        if (!hit) {
          if (toWall <= remaining) {
            b.x += b.dx * toWall; b.z += b.dz * toWall;
            this.propSys.damage(wall.prop, b.damage, b.dx, b.dz, 'bullet');
            this.burst(b.x, 1.2, b.z, 3, wall.prop.kind === 'barrel' ? 0xffb040 : 0xd8d0b8, { speed: 2, size: 0.06, life: 0.3 });
            alive = false;
          } else {
            b.x += b.dx * remaining; b.z += b.dz * remaining;
          }
          break;
        }
        b.x += b.dx * hitT; b.z += b.dz * hitT;
        remaining -= hitT; toWall -= hitT;
        this.damageZombie(hit, b.damage, b.dx, b.dz, b.knock);
        if (b.pierce > 0) { b.pierce--; (b.hits || (b.hits = [])).push(hit); }
        else alive = false;
      }
      b.life -= dt;
      if (!alive || b.life <= 0) bs.splice(i, 1);
    }
  }

  updateGrenades(dt) {
    const gs = this.grenades;
    const props = this.world.props;
    for (let i = gs.length - 1; i >= 0; i--) {
      const g = gs[i];
      g.vy -= GRAVITY * dt;
      g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
      g.spin += dt * 12;
      g.life -= dt;
      if (this.rng() < 0.5) this.parts.length < MAX_PARTS && this.parts.push({
        x: g.x, y: g.y, z: g.z, vx: 0, vy: 0.4, vz: 0, life: 0.4, max: 0.4, size: 0.12, color: 0x8a8a80, gravity: -1,
      });
      let boom = g.y <= 0.15 || g.life <= 0;
      if (!boom) {
        for (const z of this.zombies) {
          if (!z.dead && g.y < 2 * z.scale && Math.hypot(z.x - g.x, z.z - g.z) < z.radius + 0.2) { boom = true; break; }
        }
      }
      if (!boom) {
        for (const c of props) {
          if (c.destroyed || g.y > c.height) continue;
          const ox = g.x - c.x, oz = g.z - c.z;
          if (Math.abs(ox) > c.r + 0.2 || Math.abs(oz) > c.r + 0.2) continue;
          const lx = ox * c.cos - oz * c.sin, lz = ox * c.sin + oz * c.cos;
          if (Math.abs(lx) < c.hw + 0.1 && Math.abs(lz) < c.hd + 0.1) { boom = true; break; }
        }
      }
      if (boom) {
        gs.splice(i, 1);
        this.explode(g.x, g.z, { radius: g.blast.radius, damage: g.damage, impulse: g.blast.impulse }, { mine: true, scorch: true });
      }
    }
  }

  explodeLater(x, z, blast, delay) {
    if (delay <= 0) this.explode(x, z, blast);
    else this.pending.push({ t: delay, x, z, blast });
  }

  updatePending(dt) {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const e = this.pending[i];
      e.t -= dt;
      if (e.t <= 0) { this.pending.splice(i, 1); this.explode(e.x, e.z, e.blast); }
    }
  }

  /* A blast: damage falling off with distance to zombies, the survivor and
     props; a shove for everything that can move; fire, smoke and a flash. */
  explode(x, z, { radius, damage, impulse }, { mine = false, scorch = false } = {}) {
    if (!this.world) return;
    const falloff = (d, r) => Math.max(0.25, Math.pow(1 - Math.min(d / r, 1), 0.7));
    for (const zb of this.zombies) {
      if (zb.dead) continue;
      const dx = zb.x - x, dz = zb.z - z, d = Math.hypot(dx, dz);
      if (d > radius + zb.radius) continue;
      const u = d || 1;
      this.damageZombie(zb, damage * falloff(d, radius + zb.radius), dx / u, dz / u, impulse * 0.5);
    }
    const p = this.player;
    if (this.state === 'playing') {
      const d = Math.hypot(p.x - x, p.z - z);
      // Your own grenades sting less than a barrel going off beside you.
      if (d < radius) this.hurtPlayer(damage * falloff(d, radius) * (mine ? 0.4 : 0.6), x, z, { blast: true });
    }
    for (const pr of [...this.world.props]) {
      if (pr.destroyed) continue;
      const d = Math.hypot(pr.x - x, pr.z - z);
      if (d > radius + pr.r) continue;
      this.propSys.damage(pr, damage * falloff(Math.max(0, d - pr.r * 0.5), radius) * (pr.kind === 'wall' ? 1.5 : 1), pr.x - x, pr.z - z, 'blast');
    }
    this.propSys.impulse(x, z, radius * 1.3, impulse);
    this.world.navDirty = true;

    this.burst(x, 0.8, z, 26, 0xffa030, { speed: 7, up: 6, size: 0.22, life: 0.5, gravity: 4 });
    this.burst(x, 0.8, z, 14, 0xffe080, { speed: 10, up: 4, size: 0.1, life: 0.35, gravity: 8 });
    this.burst(x, 1.0, z, 18, 0x3a3a3a, { speed: 2.5, up: 3, size: 0.4, life: 1.2, gravity: -1.5 });
    this.blastLight.position.set(x, 1.6, z);
    this.blastLight.intensity = 90;
    this.blastT = 0.25;
    const pd = Math.hypot(p.x - x, p.z - z);
    this.shake = Math.max(this.shake, Math.max(0.25, 0.9 - pd / 25));
    sfx.boom();
    vibrate(pd < 10 ? 60 : 25, save.settings.haptics);
    if (scorch) {
      const s = scorchDecal(radius * 1.2);
      s.position.set(x, 0.025, z);
      s.rotation.y = this.rng() * TAU;
      this.world.addToChunk(z, s);
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
      if (c.z > p.z + 45) { cs.splice(i, 1); continue; }     // left behind on torn-down road
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
        this.run.coins += p.stats.coinMult;
        sfx.coin();
      }
    }
  }

  updateItems(dt) {
    const p = this.player;
    for (const it of this.world.items) {
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
    if (this.blastT > 0) {
      this.blastT -= dt;
      this.blastLight.intensity = Math.max(0, this.blastT / 0.25) * 90;
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

    // Grenades in flight
    const gs = this.grenades;
    for (let i = 0; i < gs.length; i++) {
      const g = gs[i];
      dummy.position.set(g.x, g.y, g.z);
      dummy.rotation.set(g.spin, g.spin * 0.7, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      this.grenadeMesh.setMatrixAt(i, dummy.matrix);
    }
    this.grenadeMesh.count = gs.length;
    this.grenadeMesh.instanceMatrix.needsUpdate = true;

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

    this.propSys.draw();
  }

  /* ── Results & HUD ──────────────────────────────────────────────────── */
  finish() {
    const r = this.run;
    const distance = Math.floor(this.distance);
    const coins = Math.floor(r.coins);
    const result = {
      character: this.character.name, distance, stage: this.stage, kills: r.kills, coins, bonus: r.bonus,
      total: coins + r.bonus, time: r.time, best: distance > save.best, startAt: r.startAt,
    };
    save.coins += result.total;
    save.kills += r.kills;
    save.runs++;
    // A run started further up the road (playtest tool) doesn't set records.
    if (!r.startAt) save.best = Math.max(save.best, distance);
    else result.best = false;
    this.hooks.finish(result);
  }

  hudState() {
    const p = this.player, r = this.run;
    const boss = r.boss && !r.boss.dead ? r.boss.hp / r.boss.maxHp : null;
    const d = this.distance;
    return {
      distance: Math.floor(d),
      stage: this.stage,
      stageProgress: (d % DIRECTOR.stageLength) / DIRECTOR.stageLength,
      coins: save.coins + Math.floor(r.coins) + r.bonus,
      hp: p.hp, maxHp: p.maxHp, armor: p.armor, maxArmor: PICKUPS.maxArmor,
      weapons: p.weapons, wi: p.wi,
      kills: r.kills, boss, low: p.hp / p.maxHp < 0.3,
      fps: save.settings.fps ? Math.round(this.fps) : null, god: save.settings.god,
      zombies: this.alive(),
    };
  }

  pause() { if (this.state === 'playing') this.state = 'paused'; }
  resume() { if (this.state === 'paused') this.state = 'playing'; }

  /* ── Portraits ──────────────────────────────────────────────────────────
     Each survivor's picture for the selection screen and HUD is rendered
     once from their 3D model, on a throwaway second renderer.             */
  renderPortraits(size = 256) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    let r;
    try {
      r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: true });
    } catch { return {}; }
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.2;
    r.setSize(size, size, false);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xc8d8ff, 0x3a2a20, 1.6));
    const key = new THREE.DirectionalLight(0xfff0dd, 2.2);
    key.position.set(2, 3, 4);
    const rim = new THREE.DirectionalLight(0x9be15d, 1.6);
    rim.position.set(-3, 2, -3);
    scene.add(key, rim);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    cam.position.set(1.1, 1.75, 3.2);
    cam.lookAt(0, 1.45, 0);
    const out = {};
    for (const c of CHARACTERS) {
      const m = makeSurvivor(c.look);
      const gun = makeGun(WEAPONS.find((w) => w.id === c.startingWeapon)?.model || 'pistol');
      gun.group.position.set(-0.2, 1.4, 0.32);
      m.body.add(gun.group);
      m.armR.rotation.set(-1.3, 0, 0.3);
      m.armL.rotation.set(-1.2, 0, -0.62);
      m.root.rotation.y = 0.35;
      scene.add(m.root);
      r.setClearColor(0x000000, 0);
      r.render(scene, cam);
      out[c.id] = canvas.toDataURL('image/png');
      scene.remove(m.root);
    }
    r.dispose();
    r.forceContextLoss();
    return out;
  }
}
