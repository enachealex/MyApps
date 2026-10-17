# Graveway

A 3D zombie survival run for Android phones, remixed from Dead Walk. Pick a
survivor and push up an endless dead street. Every 100 m the horde gets
tougher. Wreck the street as you go, and the zombies re-route around (or
over) whatever you leave behind.

- **Play in a browser:** <https://myapps.thejumpvault.com/graveway/>
  (installable, works offline).
- **Put it on your phone as an app:** see [ANDROID.md](ANDROID.md). It
  covers a cloud build that needs no setup, and a local build that installs
  over USB with `adb install -r`.

## How it plays

- **Move:** press anywhere and drag, and a joystick appears under your thumb.
  On a computer, use WASD or the arrow keys.
- **Shoot:** automatic. The aim picks the nearest zombie in range, prefers
  ones with a clear line of fire, and goes for an explosive barrel when a
  crowd is standing round it.
- **Weapons:** tap a gun on the weapon bar (or press 1–6) to switch, and tap
  the ammo card (or R) to reload early.
- **Survivors:** chosen before each run. Each has their own health, speed,
  perk and signature gun.
- **Distance is the score.** Each 100 m stage pays a coin bonus. A boss shows
  up at 500 m, then every 500 m after that.
- **Coins** (from the street, from kills, and from stage bonuses) are kept
  even when you're overrun. Spend them in the **Armory**.

## The four systems

| Pillar | Where | What it does |
| --- | --- | --- |
| **A. Weapons** | `config.js` `WEAPONS`, `weapons.js` | Each gun is a definition: `fireRate`, `damage`, `spread`, `ammoCapacity`, `reloadTime`, `model`, `projectile`, plus optional `recoil` and `blast`. A `Weapon` wraps one per run with ammo, reloads and recoil bloom. The six guns are Pistol, SMG, Shotgun, Assault Rifle (recoil), Grenade Launcher (explosive) and Minigun. |
| **B. Survivors** | `config.js` `CHARACTERS` | `name`, `role`, portrait (rendered from the 3D model), `baseHealth`, `moveSpeed`, `perk`, `startingWeapon`, `look`. The roster is Rook (faster reloads, pistol), Bram (starts with armor, shotgun), Juno (explosion resistant, launcher) and Wren (fast, extra coins, SMG). |
| **C. Director** | `config.js` `DIRECTOR`, `director.js` | Tracks distance. Stage = metres ÷ 100. Zombie health = base × (1 + 0.15 × stage), with damage and speed scaling too. Horde spacing, horde size, straggler rate and the cap on zombies up at once all tighten per stage. Runners join at stage 1, tanks at stage 3, the boss at stage 5. |
| **D. Destruction + pathfinding** | `config.js` `PROPS`, `props.js`, `nav.js` | Barrels explode and chain. Barricades and brick walls take damage from bullets, blasts and smashing tanks, and break into debris and rubble. Walls topple first. Blasts shove cars and barricades. A navigation grid with a flow field (the stand-in for a NavMesh) rebuilds whenever anything breaks, falls or moves. Zombies path round obstacles, wade slowly through rubble, and beat down barricades when there's no way round. |

## Making it yours

Almost everything about how the game *feels* is one number in
[`src/config.js`](src/config.js). Edit it and reload.

| File | What's in it |
| --- | --- |
| `src/config.js` | Every tunable: guns, survivors, upgrades, zombies, the director, props |
| `src/game.js` | The run: player, auto-aim, firing, zombies, bullets, grenades, explosions, camera, HUD state |
| `src/director.js` | Who spawns, where and when, from the distance travelled |
| `src/nav.js` | The navigation grid and flow field |
| `src/props.js` | Damage, destruction, debris, rubble and shoves for street props |
| `src/world.js` | Streams the endless street in 32 m chunks and places props, pickups and alleys |
| `src/weapons.js` | The `Weapon` class |
| `src/models.js` | Every model, built from boxes, plus canvas-painted textures |
| `src/ui.js` | Menu, survivor select, Armory, HUD, results, notes, settings |
| `src/audio.js` | Synthesised sound effects (there are no audio files) |
| `src/input.js` | Floating joystick and keyboard |
| `src/save.js` | Progress and playtest notes in localStorage |
| `sw.js` | Offline support. Add new files to its list and bump `CACHE` |
| `android.json` | Android app settings read by `tools/android/build-apk.mjs` |

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
