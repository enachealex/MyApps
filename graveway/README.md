# Graveway

A 3D zombie survival run for Android phones, remixed from Dead Walk. Pick a
survivor and push up an endless dead street. Every 100 m the horde gets
tougher. Wreck the street as you go, and the zombies re-route around (or
over) whatever you leave behind.

- **Play in a browser:** <https://myapps.thejumpvault.com/graveway/>
  (installable, works offline).
- **Put it on your phone as an app:** see [ANDROID.md](ANDROID.md). It
  covers a cloud build that needs no setup, and a local build that installs
  over USB with `adb install -r`. From 0.7 the app updates itself on
  startup from new cloud builds, with no reinstall.

## How it plays

- **Move:** press anywhere and drag, and a joystick appears under your thumb.
  On a computer, use WASD or the arrow keys. The gun and pause buttons work
  while you steer, and if you swap thumbs the new one takes over the stick.
- **Shoot:** automatic. The aim picks the nearest zombie in range, prefers
  ones with a clear line of fire, and goes for an explosive barrel when a
  crowd is standing round it.
- **Weapons:** tap a gun on the weapon bar (or press 1–4) to switch, and tap
  the ammo card (or R) to reload early.
- **Gun parts:** guns are upgraded by swapping parts, bought per gun under
  **Armory → Weapons → Parts**. The slots are barrel, muzzle, magazine,
  sight, stock, trigger, grip, handguard and ammo. Most parts trade one stat
  for another (damage, fire rate, accuracy, recoil, stability, range,
  magazine, reload), and some do something special: armor-piercing,
  hollow-point and incendiary rounds; slugs, dragon's breath and flechettes
  for the shotgun; incendiary, cluster and concussion grenades; a
  suppressor so gunfire doesn't bring zombies running; a laser sight; a
  weapon light. Fitted parts show on the gun.
- **Fog of war:** you can't see through tall things (cars, walls, tankers,
  slabs, collapsed buildings, building corners at alleys). Zombies behind
  them are hidden, and the auto-aim won't shoot at what you can't see.
  The ground behind each one is in shadow.
- **Loadout:** you carry your survivor's own gun plus up to three more.
  Choose them under **Armory → Weapons** (Equip / Unequip), or from the
  **Loadout** button on survivor select. A gun you buy goes straight in.
- **Power-ups:** glowing badges on the road, sometimes left by tanks and
  always by a boss. Walk over one and it goes off at once:
  - **Frag Barrage** throws four grenades at the thickest crowds near you.
  - **Rapid Fire** doubles your fire rate with no reloads for 10 s.
  - **Double Damage** doubles every shot for 10 s.
  - **Shockwave** knocks everything around you flat.
  - **Coin Vacuum** pulls in every coin within 32 m for 8 s.

  Their blasts can't hurt you (a barrel they set off still can). Timed ones
  count down at the bottom left.
- **Armor** takes every hit until it's gone, then your health does.
- **Survivors:** chosen before each run. Each has their own health, speed,
  perk and signature gun.
- **Distance is the score.** Each 100 m stage pays a coin bonus. A boss shows
  up at 500 m, then every 500 m after that.
- **Coins** (from the street, from kills, and from stage bonuses) are kept
  even when you're overrun. Spend them in the **Armory**.

## The four systems

| Pillar | Where | What it does |
| --- | --- | --- |
| **A. Weapons** | `config.js` `WEAPONS`, `weapons.js` | Each gun is a definition: `fireRate`, `damage`, `spread`, `ammoCapacity`, `reloadTime`, `model`, `projectile`, plus optional `recoil` and `blast`. A `Weapon` wraps one per run with ammo, reloads and recoil bloom. The six guns are Pistol, SMG, Shotgun, Assault Rifle (recoil), Grenade Launcher (explosive) and Minigun. Parts (`PARTS`, `PART_SLOTS`) change each gun's numbers through `weaponStats`. `LOADOUT_SLOTS` sets how many you carry. |
| **B. Survivors** | `config.js` `CHARACTERS` | `name`, `role`, portrait (rendered from the 3D model), `baseHealth`, `moveSpeed`, `perk`, `startingWeapon`, `look`. The roster is Rook (faster reloads, pistol), Bram (starts with armor, shotgun), Juno (explosion resistant, launcher) and Wren (fast, extra coins, SMG). |
| **C. Director** | `config.js` `DIRECTOR`, `director.js` | Tracks distance. Stage = metres ÷ 100. Zombie health = base × (1 + 0.15 × stage), with damage and speed scaling too. Horde spacing, horde size, straggler rate and the cap on zombies up at once all tighten per stage. Runners join at stage 1, tanks at stage 3, the boss at stage 5. |
| **D. Destruction + pathfinding** | `config.js` `PROPS` / `SET_PIECES`, `props.js`, `nav.js`, `vfx.js` | Everything on the street stops bullets (props and building fronts) and can be wrecked. Cars and the rare fuel tanker smoke, catch fire, explode, get thrown and tumble, and land as burning wrecks. Barrels chain. Lamp posts and brick walls topple and crush what they land on. Condemned buildings creak, then collapse across the road into a rubble field with slabs. Blasts throw zombies and shove props. A navigation grid with a flow field (the stand-in for a NavMesh) rebuilds after every change, so zombies path round the wreckage, wade through rubble, and smash barricades when there's no way round. |

## Making it yours

Almost everything about how the game *feels* is one number in
[`src/config.js`](src/config.js). Edit it and reload.

| File | What's in it |
| --- | --- |
| `src/config.js` | Every tunable: guns, gun parts, loadout slots, survivors, upgrades, power-ups, zombies, the director, props |
| `src/game.js` | The run: player, auto-aim, firing, zombies, bullets, grenades, explosions, power-ups, camera, HUD state |
| `src/director.js` | Who spawns, where and when, from the distance travelled |
| `src/nav.js` | The navigation grid and flow field |
| `src/props.js` | Damage, destruction, toppling, collapses, flying wrecks, debris, rubble |
| `src/vfx.js` | Fireballs, smoke, dust, sparks, embers and shock rings (camera-facing sprites) |
| `src/fog.js` | Fog of war: what the survivor can see, and the shadows behind cover |
| `src/preview.js` | The pictures of guns with their parts in the Armory |
| `src/world.js` | Streams the endless street in 32 m chunks and places props, pickups, power-ups and alleys |
| `src/weapons.js` | The `Weapon` class |
| `src/models.js` | Every model, built from boxes, plus canvas-painted textures |
| `src/ui.js` | Menu, survivor select, Armory, HUD, results, notes, settings |
| `src/audio.js` | Synthesised sound effects (there are no audio files) |
| `src/input.js` | Floating joystick and keyboard |
| `src/save.js` | Progress and playtest notes in localStorage |
| `src/updater.js` | The Android app's self-update from GitHub Releases |
| `sw.js` | Offline support. Add new files to its list and bump `CACHE` |
| `android.json` | Android app settings read by `tools/android/build-apk.mjs` |

Playtest notes (pause → **Leave a note**) go to Claude through
**Settings → Playtest notes → Send to Claude**, which opens a pre-filled
GitHub issue on `FEEDBACK_REPO` (set in `config.js`).

From the browser console (or `chrome://inspect` for the Android app),
`graveway.game` and `graveway.save` let you poke at a running game, for
example `graveway.save.coins = 5000`.

## Running it locally

It's plain ES modules with no build step. Serve the repo over HTTP (modules
don't load from `file://`). From the repo root:

```bash
npx serve .
# then open http://localhost:3000/graveway/
```

## Credits

- [three.js](https://threejs.org/) r170 (MIT), vendored in `vendor/`
- [Bebas Neue](https://github.com/dharmatype/Bebas-Neue) (SIL OFL 1.1), in `fonts/`
- Android packaging by [Capacitor](https://capacitorjs.com/) (MIT), fetched at build time
