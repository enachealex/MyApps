# Graveway

A 3D zombie road shooter for phones, in the spirit of Dead Walk. Each level
is a city street choked with the dead. Fight your way up it to the green
safe zone at the far end.

Live at **https://myapps.thejumpvault.com/graveway/**. Open it on your phone
and use *Add to Home Screen* to play it full-screen. After the first load it
works offline.

## How it plays

- **Move:** press anywhere and drag, and a joystick appears under your thumb.
  On a computer, use WASD or the arrow keys.
- **Shoot:** automatic. Your survivor aims at the nearest zombie in range,
  preferring ones up the road.
- **Reload:** happens on its own when the magazine is empty. Tap the ammo
  card (or press R) to reload early.
- **Swap guns:** the button above the ammo card (Q / E on a keyboard).
- **Pick up:** coins (from the street and from kills), white med kits (+35
  health) and blue vests (+50 armor; armor soaks 70% of each hit).
- **Bosses:** every fifth level a giant blocks the safe zone, and the zone
  won't open until it's dead.

You keep your coins even when you're overrun. Spend them in the **Armory**:
unlock the SMG, Shotgun, Assault Rifle and Minigun, upgrade each gun's
damage, fire rate and magazine, and upgrade your survivor's health, speed
and coin magnet.

## Making it yours

Almost everything about how the game *feels* is one number in
[`src/config.js`](src/config.js): gun stats and prices, zombie health, speed
and damage, upgrade costs, and the per-level difficulty curve in
`levelSpec()`. Edit it and reload.

| File | What's in it |
| --- | --- |
| `src/config.js` | Every tunable number |
| `src/game.js` | The level loop: player, auto-aim, zombies, bullets, pickups, camera |
| `src/world.js` | Builds each street: buildings, wrecks, lamps, the safe zone, where hordes wait |
| `src/models.js` | Every model, built from boxes, plus the canvas-painted textures |
| `src/ui.js` | Menu, Armory, HUD, pause and results screens |
| `src/audio.js` | Synthesised sound effects (there are no audio files) |
| `src/input.js` | The floating joystick and keyboard |
| `src/save.js` | Progress, kept in this browser's localStorage |
| `sw.js` | Offline support. Add new files to its list and bump `CACHE` |

From the browser console, `graveway.game` and `graveway.save` let you poke
at a running game, for example `graveway.save.coins = 5000`.

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
