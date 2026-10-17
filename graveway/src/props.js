/* What happens to the street when the fighting reaches it.

   - Every prop takes damage from bullets, blasts and smashing tanks, scaled
     by its bulletMult / blastMult (see PROPS in config.js).
   - Cars and the fuel tanker smoke when hurt, catch fire, then blow up: the
     blast throws the wreck into the air, it tumbles, lands (maybe on its
     roof) and burns.
   - Explosive barrels go off and set off their neighbours.
   - Walls and lamp posts topple away from the hit and crush what they land
     on. A condemned building creaks, then comes down across the road as a
     rubble field with slabs in it.
   - Barricades, fire barrels and slabs break into flying debris and rubble.
   - Blasts shove anything with mass. Light things get thrown.

   Every change to what stands where sets world.navDirty, so the zombies'
   navigation grid is rebuilt and they re-route around (or over) the new
   layout. Debris chunks are instanced: one draw call for all of them. */

import * as THREE from '../vendor/three.module.min.js';
import { WALK_HALF } from './world.js';
import { FLASH_MAT, BURNT, makeRubble, makeSlab, scorchDecal, sharedGeo } from './models.js';
import { sfx, vibrate } from './audio.js';
import { save } from './save.js';

const MAX_DEBRIS = 420;
const GRAVITY = 22;
const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const DEBRIS_COLORS = {
  metal: [0x3a3c40, 0x5a5c60, 0x2a2622],
  concrete: [0x8d8a82, 0x7a766e, 0x6a665e],
  brick: [0x8a5a44, 0x7a4a36, 0x6a6460],
  wood: [0x7a5a34, 0x5a4024],
};

export class PropSystem {
  constructor(game) {
    this.game = game;
    this.debris = [];
    this.toppling = [];
    this.mesh = new THREE.InstancedMesh(sharedGeo().particle, new THREE.MeshLambertMaterial({ color: 0xffffff }), MAX_DEBRIS);
    for (let i = 0; i < MAX_DEBRIS; i++) this.mesh.setColorAt(i, tmpColor.set(0xffffff));
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    game.scene.add(this.mesh);
  }

  reset() {
    this.debris.length = 0;
    this.toppling.length = 0;
  }

  get world() { return this.game.world; }
  get vfx() { return this.game.vfx; }

  /* ── Damage ──────────────────────────────────────────────────────────── */
  damage(p, dmg, dx = 0, dz = 0, cause = 'bullet') {
    if (p.destroyed || p.hp === null) return;
    const def = p.def;
    if (cause === 'blast') dmg *= def.blastMult || 1;
    else if (cause === 'bullet') dmg *= def.bulletMult || 1;
    p.hp -= dmg;
    if (p.meshes.length && !p.wreck) {
      if (p.flash <= 0) for (const m of p.meshes) m.material = FLASH_MAT;
      p.flash = 0.05;
    }
    const k = Math.max(0, p.hp / p.maxHp);
    // Walls and condemned buildings show their wounds.
    if ((p.kind === 'wall' || p.kind === 'condemned') && p.meshes[0]) p.meshes[0].userData.mat.color.setScalar(0.45 + 0.55 * k);
    // Vehicles smoke, then burn, before they go.
    if (def.burns && p.hp > 0) {
      const big = p.kind === 'tanker' ? 1.6 : 1;
      if (k < def.smokeAt && !p.smoking) {
        p.smoking = this.vfx.emit({ kind: 'smoke', follow: p, dy: 1.3, rate: 6, life: 1e9, size: big, alpha: 0.4 });
      }
      if (k < def.fireAt && !p.burning) {
        p.burning = this.vfx.emit({ kind: 'fire', follow: p, dy: 1.1, rate: 16, life: 1e9, size: 1.1 * big, spread: 1 });
        sfx.ignite();
      }
    }
    if (p.hp <= 0) this.destroy(p, dx, dz, cause);
  }

  destroy(p, dx, dz, cause) {
    const g = this.game;
    p.hp = 0;
    for (const m of p.meshes) m.material = m.userData.mat;
    this.world.navDirty = true;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    const def = p.def;

    if (p.kind === 'car' || p.kind === 'tanker') {
      this.wreck(p, cause);
      return;
    }
    p.destroyed = true;
    if (def.topples) {
      this.topple(p, dx, dz);
      return;
    }
    p.group.visible = false;
    if (p.kind === 'barrel') {
      this.spray(p, 12, 'metal', 7);
      // A beat of delay makes chain reactions ripple instead of popping at once.
      g.explodeLater(p.x, p.z, def.explodes, cause === 'blast' ? 0.09 : 0);
      this.scorch(p.x, p.z, 4.5);
      return;
    }
    this.spray(p, p.kind === 'barricade' ? 18 : 12, def.material, 5);
    this.vfx.dust(p.x, p.z, 1.5, this.vfx.n(5), undefined, 1.6);
    this.leaveRubble(p, p.x, p.z, p.hw * 2, p.hd * 2 + 0.6);
    sfx.crumble();
    g.shake = Math.max(g.shake, 0.2);
  }

  /* A vehicle goes up: blast, burnt-out shell thrown into the air, fire. */
  wreck(p, cause) {
    const g = this.game, def = p.def;
    p.wreck = true;
    p.hp = null;                           // what's left can't be destroyed again
    const parts = p.model.burn;
    if (parts) {
      parts.body.material = parts.body.userData.mat = BURNT.body;
      parts.cabin.material = parts.cabin.userData.mat = BURNT.glass;
      parts.lights.material = BURNT.lamp;
      parts.heads.material = BURNT.lamp;
    }
    if (p.smoking) p.smoking.dead = true;
    if (p.burning) p.burning.dead = true;
    const big = p.kind === 'tanker';
    g.explodeLater(p.x, p.z, def.explodes, cause === 'blast' ? 0.12 : 0, { vehicle: true });
    // Up it goes, tumbling.
    const R = g.rng;
    p.airborne = true;
    p.y = Math.max(p.y, 0.05);
    p.vy = big ? 5 + R() * 2 : 7 + R() * 4;
    p.vx += (R() - 0.5) * 3;
    p.vz += (R() - 0.5) * 3;
    p.spin = new THREE.Vector3((R() - 0.5) * (big ? 1.5 : 5), (R() - 0.5) * 2, (R() - 0.5) * (big ? 1.5 : 6));
    p.quat = p.group.quaternion.clone();
    p.moving = true;
    this.spray(p, big ? 30 : 18, 'metal', big ? 12 : 9, p.x, p.z, 1.2);
    p.burning = this.vfx.emit({ kind: 'fire', follow: p, dy: 0.9, rate: big ? 34 : 22, life: big ? 16 : 11, size: big ? 2.6 : 1.7, spread: big ? 3.4 : 1.6 });
    p.smoking = this.vfx.emit({ kind: 'smoke', follow: p, dy: 1.6, rate: big ? 10 : 6, life: 30, size: big ? 2.2 : 1.5, alpha: 0.5, color: [0.16, 0.15, 0.14] });
    this.scorch(p.x, p.z, big ? 11 : 6.5);
    if (big) this.game.hooks.banner('Tanker down!', null, 1400);
  }

  /* Things that fall over: walls, lamp posts, the condemned building. */
  topple(p, dx, dz) {
    let fx, fz;
    if (p.kind === 'condemned') {
      // Always into the road: its local +x.
      fx = p.cos; fz = -p.sin;
    } else if (p.kind === 'wall') {
      // Along the wall's own z, whichever way the hit pushed it.
      const s = Math.sign((dx * p.sin + dz * p.cos) || 1);
      fx = p.sin * s; fz = p.cos * s;
    } else {
      // Lamps fall the way they were hit, but never into the buildings.
      fx = dx; fz = dz;
      if (Math.sign(fx) === Math.sign(p.x) && Math.abs(p.x) > 3) fx = -fx;
      const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
    }
    if (p.light) { p.light.head.visible = false; p.light.pool.visible = false; }
    const collapse = !!p.def.collapse;
    this.toppling.push({
      p, t: 0, fx, fz,
      axis: new THREE.Vector3(fz, 0, -fx),
      q0: p.group.quaternion.clone(),
      creak: collapse ? 1.3 : 0,
      dur: 0.35 + 0.28 * Math.sqrt(p.height),
    });
    if (collapse) {
      this.game.hooks.banner("It's coming down!", 'Get clear of the building', 1600);
      sfx.rumble();
      vibrate([40, 60, 40], save.settings.haptics);
    } else {
      sfx.crumble();
    }
  }

  /* Where a fallen prop lies: a box from its base out along the fall. */
  footprint(tp) {
    const p = tp.p;
    const len = p.height;
    // Its width across the fall direction.
    const px = -tp.fz, pz = tp.fx;   // perpendicular
    const lpx = px * p.cos - pz * p.sin, lpz = px * p.sin + pz * p.cos;
    const halfW = Math.abs(lpx) * p.hw + Math.abs(lpz) * p.hd;
    const cx = p.x + tp.fx * len / 2, cz = p.z + tp.fz * len / 2;
    const rot = Math.atan2(tp.fx, tp.fz);
    return { x: cx, z: cz, hw: Math.max(halfW, 0.3), hd: len / 2, rot, cos: Math.cos(rot), sin: Math.sin(rot) };
  }

  land(tp) {
    const g = this.game, p = tp.p, def = p.def;
    const fp = this.footprint(tp);
    g.crush(fp, def.crush || 100, tp.fx, tp.fz);
    if (p.kind === 'lamp') {
      // The pole stays where it fell, a low thing to step over.
      this.world.addRough({ ...fp, chunk: p.chunk });
      this.spray(p, 6, 'metal', 4, fp.x, fp.z, 0.4);
      this.vfx.sparks(p.x + tp.fx * p.height, 0.4, p.z + tp.fz * p.height, this.vfx.n(10), 6, 0.5);
      this.vfx.dust(fp.x, fp.z, 1.2, this.vfx.n(4));
      sfx.clang();
      g.shake = Math.max(g.shake, 0.2);
      return;
    }
    p.group.visible = false;
    if (p.kind === 'condemned') {
      this.collapseRubble(p, fp);
      return;
    }
    this.spray(p, 26, def.material, 5, fp.x, fp.z, 0.6);
    this.vfx.dustCloud(fp.x, fp.z, fp.hw * 2, fp.hd * 2, fp.rot, this.vfx.n(8), 1.5);
    this.leaveRubble(p, fp.x, fp.z, fp.hw * 2, fp.hd * 2, fp.rot);
    g.shake = Math.max(g.shake, 0.45);
    sfx.slam();
  }

  /* The condemned building's landing: a rubble field with slabs left
     standing in it, a wall of dust, a lot of shaking. */
  collapseRubble(p, fp) {
    const g = this.game, R = g.rng;
    const { mesh, own } = makeRubble(R, fp.hw * 2, fp.hd * 2, 0x75706a);
    mesh.position.set(fp.x, 0, fp.z);
    mesh.rotation.y = fp.rot;
    if (this.world.addToChunk(fp.z, mesh, own) >= 0) {
      this.world.addRough({ x: fp.x, z: fp.z, hw: fp.hw, hd: fp.hd, cos: fp.cos, sin: fp.sin, chunk: this.world.chunkAt(fp.z) });
    }
    // Two or three big slabs that block outright, with gaps between.
    const n = 2 + Math.floor(R() * 2);
    for (let i = 0; i < n; i++) {
      const along = (i + 0.5) / n * fp.hd * 2 - fp.hd + (R() - 0.5) * 1.5;
      const across = (R() - 0.5) * fp.hw;
      const x = fp.x + across * fp.cos + along * fp.sin;
      const z = fp.z - across * fp.sin + along * fp.cos;
      if (Math.abs(x) > WALK_HALF - 1) continue;
      const slab = makeSlab(R, 1.6 + R() * 1.4, 0.9 + R() * 0.8, 1.2 + R() * 1.2);
      slab.group.rotation.x = (R() - 0.5) * 0.3;
      this.world.addProp('slab', slab, x, z, fp.rot + (R() - 0.5) * 0.8, this.world.chunkAt(z));
    }
    this.spray(p, 60, 'concrete', 8, fp.x, fp.z, 1.5);
    this.vfx.dustCloud(fp.x, fp.z, fp.hw * 2.4, fp.hd * 2.2, fp.rot, this.vfx.n(46), 6);
    this.vfx.dust(fp.x, fp.z, 9, this.vfx.n(22), undefined, 4);
    this.vfx.ring(fp.x, fp.z, 26, 0.7);
    g.shake = Math.max(g.shake, 1.1);
    sfx.collapse();
    vibrate([120, 40, 200], save.settings.haptics);
  }

  leaveRubble(p, x, z, w, d, rot = p.rot) {
    if (!p.def.rubble) return;
    const { mesh, own } = makeRubble(this.game.rng, w, d, DEBRIS_COLORS[p.def.material]?.[0] || 0x6d625a);
    mesh.position.set(x, 0, z);
    mesh.rotation.y = rot;
    const chunk = this.world.addToChunk(z, mesh, own);
    if (chunk < 0) return;
    this.world.addRough({ x, z, hw: w / 2, hd: d / 2, cos: Math.cos(rot), sin: Math.sin(rot), chunk });
  }

  scorch(x, z, size) {
    const s = scorchDecal(size);
    s.position.set(x, 0.025, z);
    s.rotation.y = this.game.rng() * 6.28;
    this.world.addToChunk(z, s);
  }

  /* Bits flying off a broken prop. */
  spray(p, n, material, speed, x = p.x, z = p.z, y = p.height * 0.6) {
    const rng = this.game.rng;
    const colors = DEBRIS_COLORS[material] || DEBRIS_COLORS.concrete;
    const count = Math.round(n * (this.vfx.scale < 1 ? 0.6 : 1));
    for (let i = 0; i < count; i++) {
      if (this.debris.length >= MAX_DEBRIS) this.debris.shift();
      const a = rng() * Math.PI * 2, s = speed * (0.3 + rng() * 0.7);
      const big = rng() < 0.15;
      this.debris.push({
        x: x + (rng() - 0.5) * p.hw * 1.5, y: y * (0.4 + rng() * 0.8), z: z + (rng() - 0.5) * p.hd * 1.5,
        vx: Math.cos(a) * s, vy: 3 + rng() * 6, vz: Math.sin(a) * s,
        rx: rng() * 6, ry: rng() * 6, wx: (rng() - 0.5) * 16, wy: (rng() - 0.5) * 16,
        size: big ? 0.35 + rng() * 0.35 : 0.1 + rng() * 0.22,
        color: tmpColor.set(colors[Math.floor(rng() * colors.length)]).offsetHSL(0, 0, (rng() - 0.5) * 0.1).getHex(),
        life: 6 + rng() * 4, rest: false,
      });
    }
  }

  /* A blast's shove: props with mass slide, spin and (if light, or the
     blast is big) fly; debris gets kicked about. */
  impulse(x, z, radius, strength) {
    const R = this.game.rng;
    for (const p of this.world.props) {
      if (p.destroyed || !p.def.mass) continue;
      const dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz);
      if (d > radius + p.r) continue;
      const k = strength * (1 - Math.min(d, radius) / (radius + p.r)) / p.def.mass;
      p.vx += (dx / (d || 1)) * k;
      p.vz += (dz / (d || 1)) * k;
      p.va += (R() - 0.5) * k * 0.6;
      p.moving = true;
      if (k > 2.5 && !p.airborne) {
        // Thrown: up into the air, tumbling.
        p.airborne = true;
        p.vy = Math.min(12, k * 1.1);
        p.quat = p.group.quaternion.clone();
        p.spin = new THREE.Vector3((R() - 0.5) * k, (R() - 0.5) * k * 0.5, (R() - 0.5) * k);
      }
    }
    for (const b of this.debris) {
      const dx = b.x - x, dz = b.z - z, d = Math.hypot(dx, dz);
      if (d > radius * 1.5) continue;
      const k = strength * (1 - d / (radius * 1.5));
      b.vx += (dx / (d || 1)) * k; b.vz += (dz / (d || 1)) * k; b.vy += k * 0.6; b.rest = false;
    }
  }

  /* ── Frame ───────────────────────────────────────────────────────────── */
  update(dt) {
    const world = this.world;
    const props = world.props;

    for (const p of props) {
      if (p.flash > 0) {
        p.flash -= dt;
        if (p.flash <= 0) for (const m of p.meshes) m.material = m.userData.mat;
      }
      if (!p.moving || p.destroyed) continue;
      p.x += p.vx * dt; p.z += p.vz * dt;
      if (p.airborne) {
        p.vy -= GRAVITY * dt;
        p.y += p.vy * dt;
        // tumble: integrate angular velocity into the orientation
        const w = p.spin.length();
        if (w > 1e-4) {
          tmpQ.setFromAxisAngle(tmpV.copy(p.spin).divideScalar(w), w * dt);
          p.quat.premultiply(tmpQ);
        }
        if (p.y <= 0 && p.vy < 0) {
          p.y = 0;
          if (p.vy < -4) {
            // bounce, losing most of the spin
            p.vy = -p.vy * 0.28;
            p.spin.multiplyScalar(0.45);
            p.vx *= 0.6; p.vz *= 0.6;
            this.game.shake = Math.max(this.game.shake, 0.25);
            sfx.clang();
            this.vfx.dust(p.x, p.z, 1.6, this.vfx.n(4));
          } else {
            this.settle(p);
          }
        }
        p.group.quaternion.copy(p.quat);
        p.group.position.set(p.x, p.y, p.z);
      } else {
        p.rot += p.va * dt;
        const sp = Math.hypot(p.vx, p.vz);
        const decel = Math.min(sp, 9 * dt);
        if (sp > 0) { p.vx -= (p.vx / sp) * decel; p.vz -= (p.vz / sp) * decel; }
        p.va *= Math.exp(-3 * dt);
        if (p.quat) {
          tmpQ.setFromAxisAngle(UP, p.va * dt);
          p.quat.premultiply(tmpQ);
          p.group.quaternion.copy(p.quat);
        } else {
          p.group.rotation.y = p.rot;
        }
        if (sp < 0.05 && Math.abs(p.va) < 0.05) { p.moving = false; p.vx = p.vz = p.va = 0; world.navDirty = true; }
      }
      const lim = WALK_HALF - Math.min(p.hw, p.hd);
      if (Math.abs(p.x) > lim) { p.x = Math.sign(p.x) * lim; p.vx *= -0.3; }
      p.cos = Math.cos(p.rot); p.sin = Math.sin(p.rot);
      p.group.position.x = p.x; p.group.position.z = p.z;
    }

    // Toppling: creak (for a collapse), then swing down about the base.
    for (let i = this.toppling.length - 1; i >= 0; i--) {
      const tp = this.toppling[i];
      tp.t += dt;
      const p = tp.p;
      if (tp.t < tp.creak) {
        // shudder and shed dust before it goes
        const j = Math.sin(tp.t * 40) * 0.012 * (tp.t / tp.creak);
        tmpQ.setFromAxisAngle(tp.axis, j + 0.02 * (tp.t / tp.creak));
        p.group.quaternion.copy(tp.q0).premultiply(tmpQ);
        if (this.game.rng() < 0.3) this.vfx.dust(p.x + tp.fx * 1.5, p.z + tp.fz * 1.5, 0.8, 1, undefined, 1.5);
        this.game.shake = Math.max(this.game.shake, 0.12);
        continue;
      }
      const k = Math.min((tp.t - tp.creak) / tp.dur, 1);
      tmpQ.setFromAxisAngle(tp.axis, (Math.PI / 2) * k * k);
      p.group.quaternion.copy(tp.q0).premultiply(tmpQ);
      if (k >= 1) {
        this.toppling.splice(i, 1);
        this.land(tp);
      }
    }

    // Debris: gravity, bounce, settle, fade.
    const ds = this.debris;
    for (let i = ds.length - 1; i >= 0; i--) {
      const b = ds[i];
      b.life -= dt;
      if (b.life <= 0) { ds.splice(i, 1); continue; }
      if (!b.rest) {
        b.vy -= GRAVITY * dt;
        b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
        b.rx += b.wx * dt; b.ry += b.wy * dt;
        if (b.y < b.size / 2) {
          b.y = b.size / 2;
          b.vy *= -0.3; b.vx *= 0.55; b.vz *= 0.55; b.wx *= 0.5; b.wy *= 0.5;
          if (Math.abs(b.vy) < 0.6 && Math.hypot(b.vx, b.vz) < 0.3) b.rest = true;
        }
      }
    }
  }

  /* An airborne prop that's come to rest: flatten it onto its wheels or its
     roof, whichever is nearer, and tell the nav grid where it ended up. */
  settle(p) {
    p.airborne = false;
    p.vy = 0;
    p.spin.set(0, 0, 0);
    p.va = 0;
    const up = tmpV.set(0, 1, 0).applyQuaternion(p.quat);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(p.quat);
    const yaw = Math.atan2(fwd.x, fwd.z);
    p.rot = Math.abs(fwd.y) > 0.9 ? p.rot : yaw;
    p.quat.setFromAxisAngle(UP, p.rot);
    if (up.y < 0) {
      // landed upside down: roll it onto its roof, sitting a little higher
      p.quat.multiply(tmpQ.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI));
      p.y = p.height;
    }
    p.group.quaternion.copy(p.quat);
    p.group.position.set(p.x, p.y, p.z);
    this.world.navDirty = true;
    this.vfx.dust(p.x, p.z, 2, this.vfx.n(5));
  }

  draw() {
    const ds = this.debris;
    for (let i = 0; i < ds.length; i++) {
      const b = ds[i];
      const s = b.size * Math.min(1, b.life);
      dummy.position.set(b.x, b.y - (b.life < 1 ? (1 - b.life) * 0.2 : 0), b.z);
      dummy.rotation.set(b.rx, b.ry, 0);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
      this.mesh.setColorAt(i, tmpColor.set(b.color));
    }
    this.mesh.count = ds.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
