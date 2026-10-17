/* Every number that shapes how Graveway plays lives in this file.
   Change a value, reload, and the game uses it. Nothing else needs touching
   to rebalance weapons, survivors, zombies, upgrades, the props you can blow
   up, or how fast the road gets harder. */

export const GAME_NAME = 'Graveway';

/* ── Weapons ───────────────────────────────────────────────────────────────
   Each entry is one weapon definition; src/weapons.js turns it into a live
   Weapon (ammo, reload timer, recoil) for a run.

   model         which gun model to show (src/models.js makeGun)
   projectile    'bullet' (instant tracer) or 'grenade' (lobbed, explodes)
   price         coins to unlock in the Armory (0 = everyone has it)
   damage        per bullet / pellet; for grenades, at the centre of the blast
   fireRate      shots per second
   spread        random aim wobble, radians either side
   ammoCapacity  shots per magazine. Reserve ammo is unlimited.
   reloadTime    seconds to reload
   range         how far the auto-aim reaches, metres
   minRange      auto-aim won't pick targets closer than this (grenades)
   pellets       projectiles per shot
   pierce        extra zombies one bullet passes through
   knockback     how hard a hit shoves a zombie
   recoil        sustained fire widens spread: +per each shot, up to +max,
                 recovering at `recover` radians per second
   blast         grenades only: radius (m) and impulse (shove strength)
   shake         camera kick per shot                                       */
export const WEAPONS = [
  { id: 'pistol', name: 'Pistol', model: 'pistol', projectile: 'bullet',
    blurb: 'Steady and forgiving. Never empty for long.',
    price: 0, damage: 22, fireRate: 3.2, spread: 0.03, ammoCapacity: 12, reloadTime: 1.0,
    range: 17, pellets: 1, pierce: 0, knockback: 1.2, shake: 0.04 },
  { id: 'smg', name: 'SMG', model: 'smg', projectile: 'bullet',
    blurb: 'Sprays lead. Melts walkers, struggles with tanks.',
    price: 350, damage: 13, fireRate: 11, spread: 0.08, ammoCapacity: 32, reloadTime: 1.5,
    range: 15, pellets: 1, pierce: 0, knockback: 0.6, shake: 0.03,
    recoil: { per: 0.006, max: 0.06, recover: 0.3 } },
  { id: 'shotgun', name: 'Shotgun', model: 'shotgun', projectile: 'bullet',
    blurb: 'Seven pellets and a big shove. Short range.',
    price: 750, damage: 16, fireRate: 1.3, spread: 0.30, ammoCapacity: 6, reloadTime: 2.0,
    range: 11, pellets: 7, pierce: 0, knockback: 3.0, shake: 0.16 },
  { id: 'rifle', name: 'Assault Rifle', model: 'rifle', projectile: 'bullet',
    blurb: 'Fast and far-reaching, and it punches through a second zombie. Kicks the longer you hold it.',
    price: 1500, damage: 24, fireRate: 9, spread: 0.02, ammoCapacity: 30, reloadTime: 1.7,
    range: 21, pellets: 1, pierce: 1, knockback: 1.2, shake: 0.06,
    recoil: { per: 0.014, max: 0.16, recover: 0.35 } },
  { id: 'launcher', name: 'Grenade Launcher', model: 'launcher', projectile: 'grenade',
    blurb: 'Lobs grenades that blow apart crowds, barrels, barricades and walls.',
    price: 2200, damage: 120, fireRate: 1.0, spread: 0.02, ammoCapacity: 4, reloadTime: 2.4,
    range: 19, minRange: 4, pellets: 1, pierce: 0, knockback: 0, shake: 0.14,
    blast: { radius: 3.4, impulse: 10 } },
  { id: 'minigun', name: 'Minigun', model: 'minigun', projectile: 'bullet',
    blurb: 'A wall of bullets. Long, loud reloads.',
    price: 3200, damage: 17, fireRate: 20, spread: 0.10, ammoCapacity: 160, reloadTime: 3.2,
    range: 18, pellets: 1, pierce: 0, knockback: 0.8, shake: 0.03,
    recoil: { per: 0.002, max: 0.05, recover: 0.2 } },
];

/* Each weapon can be upgraded a few times per stat. `step` is the gain per
   level (0.15 = +15%). Cost = baseCost x weapon tier factor x growth^level. */
export const WEAPON_UPGRADES = {
  damage:       { label: 'Damage',    max: 5, step: 0.15, baseCost: 80 },
  fireRate:     { label: 'Fire rate', max: 5, step: 0.10, baseCost: 90 },
  ammoCapacity: { label: 'Magazine',  max: 5, step: 0.20, baseCost: 60 },
};
export const UPGRADE_COST_GROWTH = 1.65;
export const WEAPON_TIER_COST = 0.45;   // each later weapon's upgrades cost 45% more

/* ── Survivors ─────────────────────────────────────────────────────────────
   Picked before every run. baseHealth and moveSpeed (m/s) are the starting
   point that Armory upgrades add to. startingWeapon is always in your hands
   for that run, even if you haven't bought it. A perk can set any of:
     reloadMult       reload time multiplier (0.6 = 40% faster)
     startArmor       armor at the start of the run
     explosionResist  share of explosion damage ignored (0.8 = 80%)
     magnetBonus      extra coin magnet reach, metres
     coinMult         coin multiplier
   look sets the model's colours and headgear (cap, helmet, goggles, hood). */
export const CHARACTERS = [
  { id: 'rook', name: 'Rook', role: 'Ex-cop',
    blurb: 'Keeps his head when the street fills up.',
    baseHealth: 100, moveSpeed: 6.2, startingWeapon: 'pistol',
    perk: { name: 'Quick Hands', text: 'Reloads 40% faster', reloadMult: 0.6 },
    look: { skin: 0xc58c64, shirt: 0x2f4a78, pants: 0x23262e, hat: 'cap', hatColor: 0x1d2a44 } },
  { id: 'bram', name: 'Bram', role: 'Riot guard',
    blurb: 'Slow, huge and very hard to put down.',
    baseHealth: 140, moveSpeed: 5.4, startingWeapon: 'shotgun',
    perk: { name: 'Riot Gear', text: 'Starts every run with 75 armor', startArmor: 75 },
    look: { skin: 0x8d5a3c, shirt: 0x3a3f46, pants: 0x1f2226, hat: 'helmet', hatColor: 0x2a2e33, bulk: 1.12 } },
  { id: 'juno', name: 'Juno', role: 'Demolitions',
    blurb: 'Brought her own launcher. Mostly unharmed by it.',
    baseHealth: 90, moveSpeed: 6.0, startingWeapon: 'launcher',
    perk: { name: 'Blast Proof', text: 'Takes 80% less explosion damage', explosionResist: 0.8 },
    look: { skin: 0xe2b48e, shirt: 0xb8382e, pants: 0x3b3328, hat: 'goggles', hatColor: 0xffb02e } },
  { id: 'wren', name: 'Wren', role: 'Courier',
    blurb: 'Fastest legs in the city, and a nose for loot.',
    baseHealth: 80, moveSpeed: 7.2, startingWeapon: 'smg',
    perk: { name: 'Scavenger', text: 'Coin magnet +2 m, 25% more coins', magnetBonus: 2, coinMult: 1.25 },
    look: { skin: 0xf0c9a4, shirt: 0xe0b020, pants: 0x2a3a52, hat: 'hood', hatColor: 0xe0b020 } },
];

/* Armory upgrades for whoever you pick. */
export const PLAYER = { magnet: 3, radius: 0.45 };
export const PLAYER_UPGRADES = {
  maxHp:  { label: 'Max health',  max: 5, step: 20,   baseCost: 100, unit: ' HP' },
  speed:  { label: 'Move speed',  max: 5, step: 0.06, baseCost: 120, unit: '%' },
  magnet: { label: 'Coin magnet', max: 5, step: 1,    baseCost: 70,  unit: ' m' },
};

/* Armor soaks up this share of every hit until it runs out. */
export const ARMOR_ABSORB = 0.7;
export const PICKUPS = { health: 35, armor: 50, maxArmor: 100 };

/* ── Zombies ───────────────────────────────────────────────────────────────
   speed is a [min, max] range in metres per second; each zombie rolls one.
   reach is how close it has to get to swing at you. smashes: walks into
   barricades and walls and beats them down instead of going round.       */
export const ZOMBIES = {
  walker: { hp: 45,   speed: [1.4, 2.2], damage: 10, attackRate: 1.0, reach: 1.1, radius: 0.42, scale: 1.0,  coins: 3,  aggro: 15, eyes: 0xd8ff6a },
  runner: { hp: 28,   speed: [4.0, 4.8], damage: 7,  attackRate: 1.4, reach: 1.0, radius: 0.38, scale: 0.92, coins: 3,  aggro: 24, eyes: 0xff3a2a },
  tank:   { hp: 260,  speed: [1.1, 1.4], damage: 24, attackRate: 0.7, reach: 1.5, radius: 0.7,  scale: 1.5,  coins: 12, aggro: 16, eyes: 0xffa020, smashes: true },
  boss:   { hp: 1400, speed: [1.6, 1.6], damage: 35, attackRate: 0.6, reach: 2.2, radius: 1.15, scale: 2.4,  coins: 100, aggro: 30, eyes: 0xff2020, smashes: true },
};

/* ── The Game Director ─────────────────────────────────────────────────────
   A run is one endless road. Every `stageLength` metres is a new stage
   (stage 0 is the first 100 m; the HUD counts from 1), and everything about
   the zombies scales with it:
     health   = base x (1 + hpPerStage x stage)
     damage   = base x (1 + damagePerStage x stage)
     speed    = base x min(1 + speedPerStage x stage, maxSpeedMult)
   Hordes wait up the road every hordeEvery(stage) metres; stragglers keep
   arriving every trickleEvery(stage) seconds so standing still never helps;
   and no more than maxActive(stage) zombies are ever up at once. Runners,
   tanks and the boss join from the stage listed in `unlocks`; the boss
   then returns every `bossEvery` stages.                                  */
export const DIRECTOR = {
  stageLength: 100,
  hpPerStage: 0.15,
  damagePerStage: 0.05,
  speedPerStage: 0.025,
  maxSpeedMult: 1.45,
  maxActive:    (stage) => Math.min(20 + stage * 6, 90),
  hordeEvery:   (stage) => Math.max(24 - stage * 1.2, 12),
  hordeSize:    (stage) => [2 + Math.floor(stage * 0.6), 4 + Math.floor(stage * 0.9)],
  trickleEvery: (stage) => Math.max(3.5 - stage * 0.25, 0.8),
  sideAmbush:   (stage) => (stage < 1 ? 0 : 0.25),      // chance a horde pours out of an alley
  unlocks: { runner: 1, tank: 3, boss: 5 },
  runnerShare:  (stage) => Math.min(0.08 + stage * 0.04, 0.35),
  tankShare:    (stage) => Math.min(0.03 + stage * 0.015, 0.16),
  bossEvery: 5,
  stageBonus:   (stage) => 10 + stage * 5,               // coins for reaching a stage
};

/* ── Props you can wreck ───────────────────────────────────────────────────
   hp          damage to destroy (null = indestructible)
   mass        how far explosions shove it (bigger = less); null = bolted down
   explodes    blows up when destroyed: radius, damage, impulse
   rubble      leaves a rough pile that slows everyone crossing it
   Every one of these blocks zombie paths while it stands; the navigation
   grid is rebuilt whenever one breaks, falls or gets shoved.             */
export const PROPS = {
  car:       { hp: null, mass: 8,   blocksBullets: true },
  barricade: { hp: 260,  mass: 3,   blocksBullets: true, rubble: true },
  barrel:    { hp: 30,   mass: 1,   blocksBullets: true, explodes: { radius: 3.8, damage: 150, impulse: 12 } },
  wall:      { hp: 480,  mass: null, blocksBullets: true, rubble: true, topples: true },
  fire:      { hp: null, mass: null, blocksBullets: false },
};
export const RUBBLE_SLOW = 0.55;        // speed multiplier on rubble for zombies
export const RUBBLE_SLOW_PLAYER = 0.75; // and for you

/* ── Derived numbers (no tuning below) ───────────────────────────────── */
export const weaponDef = (id) => WEAPONS.find((w) => w.id === id) || WEAPONS[0];
export const characterDef = (id) => CHARACTERS.find((c) => c.id === id) || CHARACTERS[0];

export function weaponStats(def, ups = {}, perk = {}) {
  const lv = (k) => ups[k] || 0;
  return {
    ...def,
    damage:       def.damage * (1 + WEAPON_UPGRADES.damage.step * lv('damage')),
    fireRate:     def.fireRate * (1 + WEAPON_UPGRADES.fireRate.step * lv('fireRate')),
    ammoCapacity: Math.round(def.ammoCapacity * (1 + WEAPON_UPGRADES.ammoCapacity.step * lv('ammoCapacity'))),
    reloadTime:   def.reloadTime * (perk.reloadMult || 1),
  };
}

export function playerStats(character, ups = {}) {
  const lv = (k) => ups[k] || 0;
  const perk = character.perk || {};
  return {
    maxHp:  character.baseHealth + PLAYER_UPGRADES.maxHp.step * lv('maxHp'),
    speed:  character.moveSpeed * (1 + PLAYER_UPGRADES.speed.step * lv('speed')),
    magnet: PLAYER.magnet + PLAYER_UPGRADES.magnet.step * lv('magnet') + (perk.magnetBonus || 0),
    radius: PLAYER.radius,
    startArmor: perk.startArmor || 0,
    explosionResist: perk.explosionResist || 0,
    coinMult: perk.coinMult || 1,
    perk,
  };
}

export function stageScaling(stage) {
  const d = DIRECTOR;
  return {
    hpMult: 1 + d.hpPerStage * stage,
    damageMult: 1 + d.damagePerStage * stage,
    speedMult: Math.min(1 + d.speedPerStage * stage, d.maxSpeedMult),
  };
}

export function weaponUpgradeCost(weaponIndex, stat, level) {
  const u = WEAPON_UPGRADES[stat];
  const raw = u.baseCost * (1 + weaponIndex * WEAPON_TIER_COST) * Math.pow(UPGRADE_COST_GROWTH, level);
  return Math.round(raw / 5) * 5;
}

export function playerUpgradeCost(stat, level) {
  const raw = PLAYER_UPGRADES[stat].baseCost * Math.pow(UPGRADE_COST_GROWTH, level);
  return Math.round(raw / 5) * 5;
}
