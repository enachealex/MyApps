/* Every number that shapes how Graveway plays lives in this file.
   Change a value, reload, and the game uses it. Nothing else needs touching
   to rebalance weapons, survivors, zombies, upgrades, the props you can blow
   up, or how fast the road gets harder. */

export const GAME_NAME = 'Graveway';

/* "Send to Claude" files playtest notes as an issue on this GitHub repo. */
export const FEEDBACK_REPO = 'enachealex/MyApps';
/* The Android app checks this repo's Releases for new builds of itself
   (see src/updater.js). */
export const UPDATE_REPO = 'enachealex/MyApps';

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
   shake         camera kick per shot
   slots         which parts it takes (see PARTS below)                     */
const ALL_SLOTS = ['barrel', 'muzzle', 'mag', 'sight', 'stock', 'trigger', 'grip', 'rail', 'ammo'];
export const WEAPONS = [
  { id: 'pistol', name: 'Pistol', model: 'pistol', projectile: 'bullet',
    blurb: 'Steady and forgiving. Never empty for long.',
    price: 0, damage: 22, fireRate: 3.2, spread: 0.03, ammoCapacity: 12, reloadTime: 1.0,
    range: 17, pellets: 1, pierce: 0, knockback: 1.2, shake: 0.04,
    recoil: { per: 0.008, max: 0.03, recover: 0.4 },
    slots: ALL_SLOTS.filter((s) => s !== 'stock') },
  { id: 'smg', name: 'SMG', model: 'smg', projectile: 'bullet',
    blurb: 'Sprays lead. Melts walkers, struggles with tanks.',
    price: 350, damage: 13, fireRate: 11, spread: 0.08, ammoCapacity: 32, reloadTime: 1.5,
    range: 15, pellets: 1, pierce: 0, knockback: 0.6, shake: 0.03,
    recoil: { per: 0.006, max: 0.06, recover: 0.3 }, slots: ALL_SLOTS },
  { id: 'shotgun', name: 'Shotgun', model: 'shotgun', projectile: 'bullet',
    blurb: 'Seven pellets and a big shove. Short range.',
    price: 750, damage: 16, fireRate: 1.3, spread: 0.30, ammoCapacity: 6, reloadTime: 2.0,
    range: 11, pellets: 7, pierce: 0, knockback: 3.0, shake: 0.16,
    recoil: { per: 0.03, max: 0.05, recover: 0.5 }, slots: ALL_SLOTS },
  { id: 'rifle', name: 'Assault Rifle', model: 'rifle', projectile: 'bullet',
    blurb: 'Fast and far-reaching, and it punches through a second zombie. Kicks the longer you hold it.',
    price: 1500, damage: 24, fireRate: 9, spread: 0.02, ammoCapacity: 30, reloadTime: 1.7,
    range: 21, pellets: 1, pierce: 1, knockback: 1.2, shake: 0.06,
    recoil: { per: 0.014, max: 0.16, recover: 0.35 }, slots: ALL_SLOTS },
  { id: 'launcher', name: 'Grenade Launcher', model: 'launcher', projectile: 'grenade',
    blurb: 'Lobs grenades that blow apart crowds, barrels, barricades and walls.',
    price: 2200, damage: 120, fireRate: 1.0, spread: 0.02, ammoCapacity: 4, reloadTime: 2.4,
    range: 19, minRange: 4, pellets: 1, pierce: 0, knockback: 0, shake: 0.14,
    blast: { radius: 3.4, impulse: 10 }, recoil: { per: 0.01, max: 0.02, recover: 0.3 },
    slots: ALL_SLOTS.filter((s) => s !== 'muzzle') },
  { id: 'minigun', name: 'Minigun', model: 'minigun', projectile: 'bullet',
    blurb: 'A wall of bullets. Long, loud reloads.',
    price: 3200, damage: 17, fireRate: 20, spread: 0.10, ammoCapacity: 160, reloadTime: 3.2,
    range: 18, pellets: 1, pierce: 0, knockback: 0.8, shake: 0.03,
    recoil: { per: 0.002, max: 0.05, recover: 0.2 },
    slots: ALL_SLOTS.filter((s) => s !== 'muzzle' && s !== 'stock') },
];

/* How many guns you take into a run, counting your survivor's own (which
   always comes). The rest are the ones equipped in the Armory. */
export const LOADOUT_SLOTS = 4;

/* ── Gun parts ─────────────────────────────────────────────────────────────
   Guns are upgraded by swapping parts, one per slot, bought separately for
   each gun in the Armory. The first part listed for a slot that fits a gun
   is what it comes with (price 0). Most parts trade one thing for another.

   mods (multipliers unless noted; 1.2 = +20%, 0.8 = -20%)
     damage, fireRate, range, ammoCapacity, reloadTime, knockback
     spread       the aim cone: lower is more accurate
     recoil       how much each shot throws the aim off
     stability    how quickly the aim settles, and how far it can wander
     pierce       added: extra zombies a bullet goes through
     pellets      set: projectiles per shot (slugs fire 1)
     blast        grenades: multiplies blast radius; impulse multiplies shove
   fx (special effects)
     fire         sets what it hits alight: dps (as a share of the hit's
                  damage, per second) for `time` seconds
     big          damage multiplier against tanks and bosses
     small        damage multiplier against walkers and runners
     props        damage multiplier against cars, walls and barricades
     quiet        firing doesn't bring zombies running
     cluster      a grenade throws out this many bomblets
     laser, light a laser line to the target / a stronger flashlight
   fits / not     which guns a part goes on, by id (default: any with the
                  slot)                                                      */
export const PART_SLOTS = {
  barrel:  'Barrel',
  muzzle:  'Muzzle',
  mag:     'Magazine',
  sight:   'Sight',
  stock:   'Stock',
  trigger: 'Trigger',
  grip:    'Grip',
  rail:    'Handguard',
  ammo:    'Ammo',
};
const BULLETS = ['pistol', 'smg', 'rifle', 'minigun'];
export const PARTS = {
  barrel: [
    { id: 'factory', name: 'Factory barrel', price: 0 },
    { id: 'long', name: 'Long barrel', price: 250, blurb: 'Reaches further and groups tighter. A little slower.',
      mods: { range: 1.2, spread: 0.85, fireRate: 0.95 } },
    { id: 'short', name: 'Short barrel', price: 200, blurb: 'Quick and handy, but it sprays.',
      mods: { fireRate: 1.1, reloadTime: 0.9, range: 0.85, spread: 1.15 } },
    { id: 'heavy', name: 'Heavy barrel', price: 400, blurb: 'Hits harder and holds steady. Slower to fire and reload.',
      mods: { damage: 1.2, stability: 1.3, fireRate: 0.9, reloadTime: 1.1 } },
  ],
  muzzle: [
    { id: 'none', name: 'Bare muzzle', price: 0 },
    { id: 'comp', name: 'Compensator', price: 200, blurb: 'Vents gas upward to fight the kick.', mods: { recoil: 0.7 }, not: ['shotgun'] },
    { id: 'brake', name: 'Muzzle brake', price: 300, blurb: 'Kills most of the kick, at some cost to accuracy.', mods: { recoil: 0.55, spread: 1.1 } },
    { id: 'suppressor', name: 'Suppressor', price: 350, blurb: 'Gunfire no longer brings zombies running. Slightly less punch.',
      mods: { recoil: 0.85, damage: 0.92 }, fx: { quiet: true } },
    { id: 'choke', name: 'Full choke', price: 250, blurb: 'Keeps the shot together for longer.', mods: { spread: 0.65, range: 1.15 }, fits: ['shotgun'] },
  ],
  mag: [
    { id: 'factory', name: 'Standard magazine', price: 0 },
    { id: 'extended', name: 'Extended magazine', price: 250, blurb: 'Half as many rounds again. Slower to change.',
      mods: { ammoCapacity: 1.5, reloadTime: 1.15 } },
    { id: 'drum', name: 'Drum magazine', price: 450, blurb: 'More than twice the rounds. Heavy and slow to change.',
      mods: { ammoCapacity: 2.2, reloadTime: 1.4, stability: 0.9 }, not: ['launcher'] },
    { id: 'quick', name: 'Speed magazine', price: 300, blurb: 'Pull tab and flared well: very quick reloads, a few rounds fewer.',
      mods: { reloadTime: 0.6, ammoCapacity: 0.85 } },
  ],
  sight: [
    { id: 'iron', name: 'Iron sights', price: 0 },
    { id: 'reddot', name: 'Red dot', price: 200, blurb: 'Quicker, tighter aim.', mods: { spread: 0.85 } },
    { id: 'holo', name: 'Holographic', price: 300, blurb: 'Tighter aim that holds under fire.', mods: { spread: 0.8, stability: 1.1 } },
    { id: 'scope', name: 'Scope', price: 450, blurb: 'Reaches much further and very accurate, but slower between shots.',
      mods: { range: 1.35, spread: 0.7, fireRate: 0.9 } },
  ],
  stock: [
    { id: 'factory', name: 'Standard stock', price: 0 },
    { id: 'light', name: 'Skeleton stock', price: 200, blurb: 'Light: quicker reloads, a bit less steady.', mods: { reloadTime: 0.85, stability: 0.9 } },
    { id: 'heavy', name: 'Padded stock', price: 300, blurb: 'Soaks up the kick. Slower to reload.', mods: { recoil: 0.75, stability: 1.25, reloadTime: 1.1 } },
    { id: 'precision', name: 'Precision stock', price: 350, blurb: 'Locks the gun in for accurate, steady fire.', mods: { spread: 0.85, stability: 1.15, fireRate: 0.95 } },
  ],
  trigger: [
    { id: 'factory', name: 'Factory trigger', price: 0 },
    { id: 'hair', name: 'Hair trigger', price: 300, blurb: 'Fires faster. A little wilder.', mods: { fireRate: 1.15, spread: 1.08 } },
    { id: 'match', name: 'Match trigger', price: 300, blurb: 'Clean break: more accurate, slightly harder hits.', mods: { spread: 0.85, damage: 1.05 } },
  ],
  grip: [
    { id: 'factory', name: 'Factory grip', price: 0 },
    { id: 'rubber', name: 'Rubber grip', price: 150, blurb: 'Takes the sting out of each shot.', mods: { recoil: 0.85 } },
    { id: 'stippled', name: 'Stippled grip', price: 250, blurb: 'Never slips: steadier, and quicker to reload.', mods: { stability: 1.2, reloadTime: 0.95 } },
    { id: 'ergo', name: 'Ergonomic grip', price: 250, blurb: 'Comfortable in a long fight: a little faster, a little less kick.', mods: { fireRate: 1.05, recoil: 0.92 } },
  ],
  rail: [
    { id: 'none', name: 'Nothing fitted', price: 0 },
    { id: 'foregrip', name: 'Vertical foregrip', price: 250, blurb: 'A second hand holds it down.', mods: { recoil: 0.75, stability: 1.15 }, not: ['pistol'] },
    { id: 'angled', name: 'Angled foregrip', price: 300, blurb: 'Very steady, and quicker to bring back on target.', mods: { stability: 1.35, reloadTime: 0.95 }, not: ['pistol'] },
    { id: 'laser', name: 'Laser sight', price: 300, blurb: 'Tighter aim, and you can see what it\'s on.', mods: { spread: 0.8 }, fx: { laser: true } },
    { id: 'light', name: 'Weapon light', price: 200, blurb: 'A brighter, wider, longer flashlight.', mods: { range: 1.1 }, fx: { light: true } },
  ],
  ammo: [
    { id: 'fmj', name: 'Full metal jacket', price: 0, fits: BULLETS },
    { id: 'buck', name: 'Buckshot', price: 0, fits: ['shotgun'] },
    { id: 'he', name: 'HE grenades', price: 0, fits: ['launcher'] },
    { id: 'hollow', name: 'Hollow points', price: 300, fits: BULLETS, blurb: 'Tear through walkers and runners. Weaker on tanks, never go through.',
      mods: { knockback: 1.2 }, fx: { small: 1.3, big: 0.8, noPierce: true } },
    { id: 'ap', name: 'Armor-piercing', price: 400, fits: BULLETS, blurb: 'Go through one more zombie, hit tanks and bosses harder, and chew through cover.',
      mods: { pierce: 1 }, fx: { big: 1.5, props: 2 } },
    { id: 'incendiary', name: 'Incendiary', price: 450, fits: BULLETS, blurb: 'Set zombies alight. Slightly less punch.',
      mods: { damage: 0.9 }, fx: { fire: { dps: 0.35, time: 3 } } },
    { id: 'slug', name: 'Slugs', price: 300, fits: ['shotgun'], blurb: 'One heavy, accurate ball that goes through a zombie and reaches further.',
      mods: { pellets: 1, damage: 5.5, spread: 0.25, pierce: 1, range: 1.3, knockback: 1.3 }, fx: { props: 2 } },
    { id: 'dragon', name: 'Dragon\'s breath', price: 450, fits: ['shotgun'], blurb: 'A cone of fire. Shorter reach.',
      mods: { damage: 0.85, range: 0.85 }, fx: { fire: { dps: 0.5, time: 3 } } },
    { id: 'flechette', name: 'Flechettes', price: 350, fits: ['shotgun'], blurb: 'Darts that pass through the first zombie.',
      mods: { damage: 0.85, spread: 0.9, pierce: 1 } },
    { id: 'incendiary-g', name: 'Incendiary grenades', price: 450, fits: ['launcher'], blurb: 'Everything caught in the blast burns.',
      mods: { damage: 0.8 }, fx: { fire: { dps: 0.12, time: 4 } } },
    { id: 'cluster', name: 'Cluster grenades', price: 550, fits: ['launcher'], blurb: 'Each one throws out three more small blasts.',
      mods: { damage: 0.75 }, fx: { cluster: 3 } },
    { id: 'concussion', name: 'Concussion grenades', price: 300, fits: ['launcher'], blurb: 'A much wider blast that throws zombies about, for less damage.',
      mods: { damage: 0.6, blast: 1.35, impulse: 2 } },
  ],
};
export const PART_TIER_COST = 0.35;     // each later gun's parts cost 35% more
export const UPGRADE_COST_GROWTH = 1.65;

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

/* Armor soaks up this share of every hit until it runs out; health only
   starts going down once it's gone. (Below 1, some of every hit gets
   through, so you can go down with armor left.) */
export const ARMOR_ABSORB = 1;
export const PICKUPS = { health: 35, armor: 50, maxArmor: 100 };

/* ── Power-ups ─────────────────────────────────────────────────────────────
   Glowing badges on the road, and sometimes left by tanks (bosses always
   leave one). Walk over one and it goes off at once. The timed ones show a
   countdown on the HUD; another of the same tops the timer up, to at most
   twice its duration.
     tag        the few words shown when you pick it up
     weight     how often it turns up compared with the others
     duration   seconds, for the timed ones
   Frag Barrage throws `grenades` at the thickest crowds within `range`; a
   Shockwave hits everything within `radius` of you. Neither blast can hurt
   you (though a barrel or car one sets off still can). */
export const POWERUPS = {
  frag:   { name: 'Frag Barrage', tag: 'Grenades out', color: 0x9be15d, weight: 3,
            grenades: 4, range: 18, damage: 150, blast: { radius: 3.6, impulse: 12 } },
  rapid:  { name: 'Rapid Fire', tag: 'No reloads', color: 0xffb02e, weight: 2, duration: 10, fireRateMult: 2 },
  double: { name: 'Double Damage', tag: '2× damage', color: 0xff5a4a, weight: 2, duration: 10, damageMult: 2 },
  shock:  { name: 'Shockwave', tag: 'Get back!', color: 0x7ac8ff, weight: 2, radius: 7, damage: 180, impulse: 24 },
  vacuum: { name: 'Coin Vacuum', tag: 'Every coin, to you', color: 0xffc928, weight: 1.5, duration: 8, radius: 32 },
};
export const POWERUP_DROPS = {
  perChunk: 0.5,      // chance of one on each 32 m of road
  from: 60,           // metres up the road before the first
  tank: 0.25,         // chance a tank leaves one
};

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

/* Gunfire wakes idle zombies this many metres away (a suppressor stops it). */
export const GUNFIRE_NOISE = 22;

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
  maxActive:    (stage) => Math.min(20 + stage * 5, 64),   // 64: what a mid-range phone draws smoothly
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
   Everything on the street stops bullets and can be broken.

   hp          damage to destroy it (null = indestructible)
   material    what bullets hit: metal sparks, concrete/brick/wood dust
   mass        how far blasts shove it (bigger = less); null = bolted down
   explodes    blows up when destroyed: radius (m), damage, impulse
   burns       smokes below smokeAt of its hp, catches fire below fireAt, and
               leaves a burning wreck when it blows
   rubble      leaves a rough pile that slows everyone crossing it
   topples     falls over when destroyed, crushing whatever it lands on for
               `crush` damage
   bulletMult / blastMult   scale incoming damage (a condemned building
               shrugs off bullets but not explosions)
   collapse    the big set piece: it creaks, then comes down across the road
               as a rubble field with slabs in it
   Every one of these blocks zombie paths while it stands; the navigation
   grid is rebuilt whenever one breaks, falls or gets shoved.             */
export const PROPS = {
  car:       { hp: 420, material: 'metal', mass: 8, blocksBullets: true, burns: true, smokeAt: 0.6, fireAt: 0.3,
               explodes: { radius: 5, damage: 170, impulse: 18 } },
  tanker:    { hp: 520, material: 'metal', mass: 24, blocksBullets: true, burns: true, smokeAt: 0.6, fireAt: 0.35,
               explodes: { radius: 9, damage: 320, impulse: 30 } },
  barricade: { hp: 260, material: 'concrete', mass: 3, blocksBullets: true, rubble: true },
  barrel:    { hp: 30, material: 'metal', mass: 1, blocksBullets: true, explodes: { radius: 3.8, damage: 150, impulse: 12 } },
  wall:      { hp: 480, material: 'brick', mass: null, blocksBullets: true, rubble: true, topples: true, crush: 220, blastMult: 1.5 },
  lamp:      { hp: 70, material: 'metal', mass: null, blocksBullets: true, topples: true, crush: 90 },
  fire:      { hp: 60, material: 'metal', mass: 1, blocksBullets: true },
  slab:      { hp: 320, material: 'concrete', mass: null, blocksBullets: true, rubble: true },
  condemned: { hp: 900, material: 'concrete', mass: null, blocksBullets: true, topples: true, collapse: true,
               crush: 2000, bulletMult: 0.15, blastMult: 1.6 },
};
// How often the road offers the big set pieces.
export const SET_PIECES = {
  condemnedEvery: 7,      // one condemned building every 7 chunks (~224 m)
  tankerChance: 0.06,     // per row of props, once past tankerFrom metres
  tankerFrom: 120,
};
export const RUBBLE_SLOW = 0.55;        // speed multiplier on rubble for zombies
export const RUBBLE_SLOW_PLAYER = 0.75; // and for you

/* ── Derived numbers (no tuning below) ───────────────────────────────── */
export const weaponDef = (id) => WEAPONS.find((w) => w.id === id) || WEAPONS[0];
export const characterDef = (id) => CHARACTERS.find((c) => c.id === id) || CHARACTERS[0];

/* A power-up id, picked by weight; r is a random number in [0, 1). */
export function pickPowerup(r) {
  const ids = Object.keys(POWERUPS);
  let w = r * ids.reduce((sum, id) => sum + POWERUPS[id].weight, 0);
  for (const id of ids) { w -= POWERUPS[id].weight; if (w < 0) return id; }
  return ids[0];
}

/* The parts that go in one slot of one gun; the first is what it comes with. */
export function partsFor(def, slot) {
  if (!def.slots.includes(slot)) return [];
  return PARTS[slot].filter((p) => (!p.fits || p.fits.includes(def.id)) && !(p.not && p.not.includes(def.id)));
}

/* The part fitted in a slot: `fitted` maps slot -> part id. */
export function fittedPart(def, slot, fitted = {}) {
  const list = partsFor(def, slot);
  return list.find((p) => p.id === fitted[slot]) || list[0];
}

export function partCost(def, part) {
  const tier = WEAPONS.indexOf(def);
  return Math.round(part.price * (1 + Math.max(0, tier) * PART_TIER_COST) / 5) * 5;
}

/* A gun's numbers with its parts fitted and the survivor's perk applied.
   fx collects the parts' special effects. */
export function weaponStats(def, fitted = {}, perk = {}) {
  const s = { ...def, recoil: { ...def.recoil }, blast: def.blast ? { ...def.blast } : null, fx: {} };
  for (const slot of def.slots) {
    const part = fittedPart(def, slot, fitted);
    const m = part.mods || {};
    for (const k of ['damage', 'fireRate', 'range', 'ammoCapacity', 'reloadTime', 'spread', 'knockback']) if (m[k]) s[k] *= m[k];
    if (m.recoil) s.recoil.per *= m.recoil;
    if (m.stability) { s.recoil.max /= m.stability; s.recoil.recover *= m.stability; }
    if (m.pierce) s.pierce += m.pierce;
    if (m.pellets) s.pellets = m.pellets;
    if (s.blast && m.blast) s.blast.radius *= m.blast;
    if (s.blast && m.impulse) s.blast.impulse *= m.impulse;
    Object.assign(s.fx, part.fx);
  }
  if (s.fx.noPierce) s.pierce = 0;
  s.ammoCapacity = Math.max(1, Math.round(s.ammoCapacity));
  s.reloadTime *= perk.reloadMult || 1;
  return s;
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

export function playerUpgradeCost(stat, level) {
  const raw = PLAYER_UPGRADES[stat].baseCost * Math.pow(UPGRADE_COST_GROWTH, level);
  return Math.round(raw / 5) * 5;
}
