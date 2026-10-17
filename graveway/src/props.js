/* What happens to the street's props when the fighting reaches them.

   - Bullets, blasts and smashing tanks take hp off destructible props.
   - Explosive barrels blow up when they break, and can set off their
     neighbours.
   - Barricades and walls break into flying debris and leave rubble, which
     slows anyone crossing it. A wall topples over first.
   - Blasts shove anything with mass (cars, barricades, barrels), which
     slides, spins and settles somewhere new.

   Every change to what stands where sets world.navDirty, so the zombies'
   navigation grid is rebuilt and they re-route around (or over) the new
   layout. Debris pieces are instanced: one draw call for all of them. */

import * as THREE from '../vendor/three.module.min.js';
import { WALK_HALF } from './world.js';
import { FLASH_MAT, makeRubble, scorchDecal, sharedGeo } from './models.js';
import { sfx } from './audio.js';

const MAX_DEBRIS = 320;
const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();

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

  damage(p, dmg, dx = 0, dz = 0, cause = 'bullet') {
    if (p.destroyed || p.hp === null) return;
    p.hp -= dmg;
    if (p.meshes.length) {
      if (p.flash <= 0) for (const m of p.meshes) m.material = FLASH_MAT;
      p.flash = 0.06;
    }
    // Walls show their wounds.
    if (p.kind === 'wall' && p.meshes[0]) p.meshes[0].userData.mat.color.setScalar(0.45 + 0.55 * Math.max(0, p.hp / p.maxHp));
    if (p.hp <= 0) this.destroy(p, dx, dz, cause);
  }

  destroy(p, dx, dz, cause) {
    const g = this.game;
    p.destroyed = true;
    p.hp = 0;
    for (const m of p.meshes) m.material = m.userData.mat;
    this.world.navDirty = true;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    if (p.kind === 'barrel') {
      p.group.visible = false;
      this.spray(p, 10, 0x8a1d16, 6);
      // A beat of delay makes chain reactions ripple instead of popping at once.
      g.explodeLater(p.x, p.z, p.def.explodes, cause === 'blast' ? 0.09 : 0);
      const scorch = scorchDecal(4.5);
      scorch.position.set(p.x, 0.025, p.z);
      scorch.rotation.y = Math.random() * 6.28;
      this.world.addToChunk(p.z, scorch);
    } else if (p.kind === 'wall') {
      // Topple away from whatever broke it, then crumble into rubble.
      const fall = Math.sign((dx * p.sin + dz * p.cos) || 1);   // along the wall's own z
      this.toppling.push({ p, t: 0, fall });
      sfx.crumble();
    } else {
      p.group.visible = false;
      this.spray(p, p.kind === 'barricade' ? 16 : 10, 0x8d8a82, 5);
      this.leaveRubble(p, p.x, p.z, p.hw * 2, p.hd * 2 + 0.6);
      sfx.crumble();
    }
    g.shake = Math.max(g.shake, 0.25);
  }

  leaveRubble(p, x, z, w, d, rot = p.rot) {
    if (!p.def.rubble) return;
    const { mesh, own } = makeRubble(this.game.rng, w, d);
    mesh.position.set(x, 0, z);
    mesh.rotation.y = rot;
    const chunk = this.world.addToChunk(z, mesh, own);
    if (chunk < 0) return;
    this.world.addRough({ x, z, hw: w / 2, hd: d / 2, cos: Math.cos(rot), sin: Math.sin(rot), chunk });
  }

  /* Bits flying off a broken prop. */
  spray(p, n, color, speed, x = p.x, z = p.z, y = p.height * 0.6) {
    const rng = this.game.rng;
    for (let i = 0; i < n && this.debris.length < MAX_DEBRIS; i++) {
      const a = rng() * Math.PI * 2, s = speed * (0.3 + rng() * 0.7);
      this.debris.push({
        x: x + (rng() - 0.5) * p.hw, y: y * (0.4 + rng() * 0.8), z: z + (rng() - 0.5) * p.hd,
        vx: Math.cos(a) * s, vy: 3 + rng() * 5, vz: Math.sin(a) * s,
        rx: rng() * 6, ry: rng() * 6, wx: (rng() - 0.5) * 14, wy: (rng() - 0.5) * 14,
        size: 0.12 + rng() * 0.25, color: tmpColor.set(color).offsetHSL(0, 0, (rng() - 0.5) * 0.15).getHex(),
        life: 5 + rng() * 3, rest: false,
      });
    }
  }

  /* A blast's shove: props with mass slide and spin; debris gets kicked. */
  impulse(x, z, radius, strength) {
    for (const p of this.world.props) {
      if (p.destroyed || !p.def.mass) continue;
      const dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz);
      if (d > radius + p.r) continue;
      const k = strength * (1 - Math.min(d, radius) / (radius + p.r)) / p.def.mass;
      p.vx += (dx / (d || 1)) * k;
      p.vz += (dz / (d || 1)) * k;
      p.va += (this.game.rng() - 0.5) * k * 0.6;
      p.moving = true;
    }
    for (const b of this.debris) {
      const dx = b.x - x, dz = b.z - z, d = Math.hypot(dx, dz);
      if (d > radius * 1.5) continue;
      const k = strength * (1 - d / (radius * 1.5));
      b.vx += (dx / (d || 1)) * k; b.vz += (dz / (d || 1)) * k; b.vy += k * 0.6; b.rest = false;
    }
  }

  update(dt) {
    const world = this.world;
    const props = world.props;

    // Shoved props slide to a stop, then the nav grid learns where they went.
    for (const p of props) {
      if (p.flash > 0) {
        p.flash -= dt;
        if (p.flash <= 0) for (const m of p.meshes) m.material = m.userData.mat;
      }
      if (!p.moving) continue;
      p.x += p.vx * dt; p.z += p.vz * dt; p.rot += p.va * dt;
      const sp = Math.hypot(p.vx, p.vz);
      const decel = Math.min(sp, 9 * dt);
      if (sp > 0) { p.vx -= (p.vx / sp) * decel; p.vz -= (p.vz / sp) * decel; }
      p.va *= Math.exp(-3 * dt);
      const lim = WALK_HALF - Math.min(p.hw, p.hd);
      if (Math.abs(p.x) > lim) { p.x = Math.sign(p.x) * lim; p.vx *= -0.3; }
      p.cos = Math.cos(p.rot); p.sin = Math.sin(p.rot);
      p.group.position.set(p.x, 0, p.z);
      p.group.rotation.y = p.rot;
      if (sp < 0.05 && Math.abs(p.va) < 0.05) { p.moving = false; p.vx = p.vz = p.va = 0; world.navDirty = true; }
    }

    // Toppling walls: swing down about the base, then become rubble.
    for (let i = this.toppling.length - 1; i >= 0; i--) {
      const tp = this.toppling[i];
      tp.t += dt;
      const k = Math.min(tp.t / 0.55, 1);
      tp.p.group.rotation.set(tp.fall * (Math.PI / 2) * k * k, tp.p.rot, 0, 'YXZ');
      if (k >= 1) {
        const p = tp.p;
        p.group.visible = false;
        // The wall lands flat on the side it fell, as a long slab of rubble.
        const along = tp.fall * (p.height / 2);
        const fx = p.x + p.sin * along, fz = p.z + p.cos * along;
        this.spray(p, 22, 0x8a5a44, 4, fx, fz, 0.6);
        this.leaveRubble(p, fx, fz, p.hw * 2, p.height * 0.9);
        this.game.shake = Math.max(this.game.shake, 0.4);
        sfx.slam();
        this.toppling.splice(i, 1);
      }
    }

    // Debris: gravity, bounce, settle, fade.
    const ds = this.debris;
    for (let i = ds.length - 1; i >= 0; i--) {
      const b = ds[i];
      b.life -= dt;
      if (b.life <= 0) { ds.splice(i, 1); continue; }
      if (!b.rest) {
        b.vy -= 22 * dt;
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
