/* A Weapon is one gun in the survivor's hands for one run: a definition
   from WEAPONS (src/config.js) with its fitted parts and the survivor's
   perk applied, plus its live state: rounds left, reload progress, and
   recoil bloom from sustained fire.

   Firing goes through the definition's `projectile`: 'bullet' guns spawn
   tracers that hit the first zombie or prop on their line; 'grenade' guns
   lob a shell that explodes. Game.fire() does the spawning; this class only
   decides when a shot may happen and what it looks like.                */

import { weaponStats, weaponDef } from './config.js';

export class Weapon {
  constructor(id, fitted, perk) {
    this.def = weaponDef(id);
    this.fitted = fitted;            // slot -> part id
    this.stats = weaponStats(this.def, fitted, perk);
    this.ammo = this.stats.ammoCapacity;
    this.reloadT = 0;
    this.cooldown = 0;
    this.bloom = 0;
  }

  get id() { return this.def.id; }
  get name() { return this.def.name; }
  get reloading() { return this.reloadT > 0; }
  get explosive() { return this.def.projectile === 'grenade'; }

  /* Current aim wobble: base spread plus recoil bloom. */
  get spread() { return this.stats.spread + this.bloom; }

  /* Advances timers. Returns true on the frame a reload finishes. */
  tick(dt, firing) {
    this.cooldown = Math.max(this.cooldown - dt, -0.05);
    const rc = this.stats.recoil;
    if (!firing) this.bloom = Math.max(0, this.bloom - rc.recover * dt);
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        this.reloadT = 0;
        this.ammo = this.stats.ammoCapacity;
        this.bloom = 0;
        return true;
      }
    }
    return false;
  }

  canFire() {
    return this.reloadT <= 0 && this.ammo > 0 && this.cooldown <= 0;
  }

  /* Spends one shot. Returns true when that emptied the magazine.
     rateMult speeds up the next shot and free keeps the round (Rapid Fire). */
  consume(rateMult = 1, free = false) {
    // Any time left over from this frame carries into the next shot (tick
    // floors it at -0.05 s), so fire rate doesn't round up to whole frames.
    this.cooldown += 1 / (this.stats.fireRate * rateMult);
    if (!free) this.ammo--;
    const rc = this.stats.recoil;
    this.bloom = Math.min(this.bloom + rc.per, rc.max);
    return this.ammo <= 0;
  }

  startReload() {
    if (this.reloadT > 0 || this.ammo >= this.stats.ammoCapacity) return false;
    this.reloadT = this.stats.reloadTime;
    return true;
  }

  cancelReload() { this.reloadT = 0; }

  /* 0..1 while reloading, else null. */
  get reloadProgress() {
    return this.reloadT > 0 ? 1 - this.reloadT / this.stats.reloadTime : null;
  }
}
