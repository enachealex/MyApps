/* Every number that shapes how Graveway plays lives in this file.
   Change a value, reload, and the game uses it. Nothing else needs touching
   to rebalance weapons, zombies, upgrades or how hard each level gets. */

export const GAME_NAME = 'Graveway';

/* ── Weapons ───────────────────────────────────────────────────────────────
   blurb      the one-liner shown in the Armory
   price      coins to unlock in the Armory (0 = you start with it)
   damage     per bullet (per pellet for the shotgun)
   fireRate   shots per second
   range      how far the auto-aim reaches, in metres
   mag        shots before a reload
   reload     seconds to reload
   pellets    bullets per shot
   spread     random aim wobble, in radians either side
   pierce     extra zombies one bullet passes through
   knockback  how hard a hit shoves a zombie back
   shake      camera kick per shot                                          */
export const WEAPONS = [
  { id: 'pistol',  name: 'Pistol',        blurb: 'Steady and forgiving. Never empty for long.',          price: 0,    damage: 22, fireRate: 3.2, range: 17, mag: 12,  reload: 1.0, pellets: 1, spread: 0.03, pierce: 0, knockback: 1.2, shake: 0.04 },
  { id: 'smg',     name: 'SMG',           blurb: 'Sprays lead. Melts walkers, struggles with brutes.',    price: 350,  damage: 13, fireRate: 11,  range: 15, mag: 32,  reload: 1.5, pellets: 1, spread: 0.10, pierce: 0, knockback: 0.6, shake: 0.03 },
  { id: 'shotgun', name: 'Shotgun',       blurb: 'Seven pellets and a big shove. Short range.',            price: 750,  damage: 16, fireRate: 1.3, range: 11, mag: 6,   reload: 2.0, pellets: 7, spread: 0.30, pierce: 0, knockback: 3.0, shake: 0.16 },
  { id: 'rifle',   name: 'Assault Rifle', blurb: 'Long reach. Every round punches through a second zombie.', price: 1500, damage: 30, fireRate: 7,   range: 21, mag: 30,  reload: 1.7, pellets: 1, spread: 0.04, pierce: 1, knockback: 1.4, shake: 0.06 },
  { id: 'minigun', name: 'Minigun',       blurb: 'A wall of bullets. Long, loud reloads.',                  price: 3200, damage: 17, fireRate: 20,  range: 18, mag: 160, reload: 3.2, pellets: 1, spread: 0.13, pierce: 0, knockback: 0.8, shake: 0.03 },
];

/* Each weapon can be upgraded a few times per stat. `step` is the gain per
   level (0.15 = +15%). Cost = baseCost x weapon tier factor x growth^level. */
export const WEAPON_UPGRADES = {
  damage:   { label: 'Damage',    max: 5, step: 0.15, baseCost: 80 },
  fireRate: { label: 'Fire rate', max: 5, step: 0.10, baseCost: 90 },
  mag:      { label: 'Magazine',  max: 5, step: 0.20, baseCost: 60 },
};
export const UPGRADE_COST_GROWTH = 1.65;
export const WEAPON_TIER_COST = 0.45;   // each later weapon's upgrades cost 45% more

/* ── The survivor ─────────────────────────────────────────────────────── */
export const PLAYER = { maxHp: 100, speed: 6.2, magnet: 3, radius: 0.45 };
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
   reach is how close it has to get to swing at you.                      */
export const ZOMBIES = {
  walker: { hp: 45,   speed: [1.4, 2.2], damage: 10, attackRate: 1.0, reach: 1.1, radius: 0.42, scale: 1.0,  coins: 3,  aggro: 15, eyes: 0xd8ff6a },
  runner: { hp: 28,   speed: [4.0, 4.8], damage: 7,  attackRate: 1.4, reach: 1.0, radius: 0.38, scale: 0.92, coins: 3,  aggro: 22, eyes: 0xff3a2a },
  brute:  { hp: 260,  speed: [1.1, 1.4], damage: 24, attackRate: 0.7, reach: 1.5, radius: 0.7,  scale: 1.5,  coins: 12, aggro: 15, eyes: 0xffa020 },
  boss:   { hp: 1400, speed: [1.6, 1.6], damage: 35, attackRate: 0.6, reach: 2.2, radius: 1.15, scale: 2.4,  coins: 100, aggro: 30, eyes: 0xff2020 },
};

/* ── Levels ────────────────────────────────────────────────────────────────
   Called once per level. Every fifth level ends with a boss that has to die
   before the safe zone opens.                                            */
export function levelSpec(level) {
  const n = level - 1;
  return {
    length:       Math.min(160 + level * 25, 520),
    hordeSpacing: Math.max(24 - level * 0.6, 14),
    hordeSize:    [2 + Math.floor(level * 0.5), 3 + Math.floor(level * 0.8)],
    sideAmbush:   level < 2 ? 0 : 0.25,                 // chance a horde pours out of an alley
    hpMult:       1 + n * 0.09,
    speedMult:    Math.min(1 + n * 0.025, 1.45),
    damageMult:   1 + n * 0.05,
    runnerChance: level < 2 ? 0 : Math.min(0.06 * level, 0.35),
    bruteChance:  level < 3 ? 0 : Math.min(0.025 * level, 0.16),
    boss:         level % 5 === 0,
    clearBonus:   40 + level * 15,
  };
}

/* ── Derived numbers (no tuning below) ───────────────────────────────── */
export function weaponStats(weapon, ups = {}) {
  const lv = (k) => ups[k] || 0;
  return {
    ...weapon,
    damage:   weapon.damage * (1 + WEAPON_UPGRADES.damage.step * lv('damage')),
    fireRate: weapon.fireRate * (1 + WEAPON_UPGRADES.fireRate.step * lv('fireRate')),
    mag:      Math.round(weapon.mag * (1 + WEAPON_UPGRADES.mag.step * lv('mag'))),
  };
}

export function playerStats(ups = {}) {
  const lv = (k) => ups[k] || 0;
  return {
    maxHp:  PLAYER.maxHp + PLAYER_UPGRADES.maxHp.step * lv('maxHp'),
    speed:  PLAYER.speed * (1 + PLAYER_UPGRADES.speed.step * lv('speed')),
    magnet: PLAYER.magnet + PLAYER_UPGRADES.magnet.step * lv('magnet'),
    radius: PLAYER.radius,
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
