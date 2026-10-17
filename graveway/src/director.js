/* The Game Director: decides who comes for you, and when, from how far up
   the road you've made it. Every number it uses is in DIRECTOR
   (src/config.js); this file is only the bookkeeping.

   - Distance: the furthest point reached, in metres. stage = distance /
     stageLength, rounded down.
   - Hordes wait up the road every hordeEvery(stage) metres, spawned inside
     the fog as you approach. Some pour out of alleys instead.
   - Stragglers arrive every trickleEvery(stage) seconds, from ahead, from
     alleys or from behind, so standing still never helps.
   - No more than maxActive(stage) zombies are up at once.
   - Runners and tanks join once their unlock stage is reached; the boss
     arrives at its unlock stage and every bossEvery stages after.

   Zombie health, damage and speed scale with the stage they spawn in
   (stageScaling in config.js).                                           */

import { DIRECTOR } from './config.js';

export const SPAWN_AHEAD = 52;       // metres up the road, inside the fog

export class Director {
  constructor(game) {
    this.game = game;
  }

  reset(distance) {
    const d = DIRECTOR;
    this.stage = Math.floor(distance / d.stageLength);
    this.nextHordeAt = distance + 6;
    this.trickleT = 4;
    // Starting a run on a boss stage (playtest tool) brings that boss at once.
    this.nextBoss = d.unlocks.boss;
    while (this.nextBoss < this.stage) this.nextBoss += d.bossEvery;
    this.spawned = 0;
  }

  update(dt, distance) {
    const g = this.game, d = DIRECTOR, rng = g.rng;
    const stage = Math.floor(distance / d.stageLength);
    if (stage > this.stage) {
      this.stage = stage;
      g.onStage(stage);
    }

    if (stage >= this.nextBoss) {
      this.nextBoss += d.bossEvery;
      g.spawnBoss();
    }

    // Hordes up the road, by distance.
    if (distance >= this.nextHordeAt) {
      this.nextHordeAt = distance + d.hordeEvery(stage) * (0.75 + rng() * 0.5);
      const [lo, hi] = d.hordeSize(stage);
      const count = lo + Math.floor(rng() * (hi - lo + 1));
      const alleys = g.world.alleys.filter((a) => a.z < g.player.z - 12 && a.z > g.player.z - 40);
      if (alleys.length && rng() < d.sideAmbush(stage)) {
        g.spawnGroup(count, stage, { alley: alleys[Math.floor(rng() * alleys.length)] });
      } else {
        g.spawnGroup(count, stage, { z: g.player.z - SPAWN_AHEAD - rng() * 8 });
      }
    }

    // Stragglers, by time.
    this.trickleT -= dt;
    if (this.trickleT <= 0) {
      this.trickleT = d.trickleEvery(stage) * (0.7 + rng() * 0.6);
      const r = rng();
      const alleys = g.world.alleys.filter((a) => Math.abs(a.z - g.player.z) < 30);
      if (r < 0.2 && stage >= 1) g.spawnGroup(1, stage, { z: g.player.z + 22, behind: true });
      else if (r < 0.45 && alleys.length) g.spawnGroup(1, stage, { alley: alleys[Math.floor(rng() * alleys.length)] });
      else g.spawnGroup(1 + (rng() < 0.3 ? 1 : 0), stage, { z: g.player.z - SPAWN_AHEAD + rng() * 6 });
    }
  }

  /* Which kind of zombie, for a spawn at this stage. */
  pickKind(stage) {
    const d = DIRECTOR, r = this.game.rng();
    const tank = stage >= d.unlocks.tank ? d.tankShare(stage) : 0;
    const runner = stage >= d.unlocks.runner ? d.runnerShare(stage) : 0;
    if (r < tank) return 'tank';
    if (r < tank + runner) return 'runner';
    return 'walker';
  }

  maxActive(stage) { return DIRECTOR.maxActive(stage); }
}
