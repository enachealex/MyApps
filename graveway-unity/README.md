# Graveway for Unity

The Unity version of [Graveway](../graveway/README.md), being ported from
the web version one system at a time. The web version stays the one you
play and test until this one catches up.

## Opening it

1. Install [Unity Hub](https://unity.com/download) and, from it, **Unity 6
   LTS** (6000.0.x) with **Android Build Support** (tick OpenJDK and the
   Android SDK & NDK under it).
2. In Unity Hub: **Add → Add project from disk**, pick this
   `graveway-unity` folder. If Hub offers a newer 6000.0 version than the
   one in `ProjectSettings/ProjectVersion.txt`, that's fine.
3. The first open takes a few minutes while Unity imports. A setup script
   then names the app, sets portrait and the Android options, makes
   `Assets/Graveway/Scenes/Main.unity` and opens it. It's empty on
   purpose: the game builds itself when it starts.
4. Press **Play**. In the Game view, pick a phone size (for example
   1080×2400 Portrait) from the resolution menu. Drag with the mouse to
   move (or use WASD); aiming and shooting are automatic. R reloads, 1–4 or
   Q/E switch guns, P or Esc pauses.

To run it on your phone: **File → Build Profiles → Android → Switch
Platform**, plug the phone in with USB debugging on, then **Build And
Run**. The first build is slow.

If something's wrong, the **Console** window (Window → General → Console)
says what. Copy its red lines into a message to Claude.

Unity puts a `.meta` file next to every file and folder on first open.
Commit those along with everything else (the `.gitignore` here already
leaves out the folders Unity rebuilds itself, like `Library/`).

## How it's put together

Everything is made in code at start-up, the way the web version is: no
prefabs, no scene setup, and placeholder art (boxes and painted textures)
until real models arrive. Real models can be dropped in later without
touching the game logic: `Humanoid` is the one place a character's look
lives, and `Art` is the one place materials and meshes come from.

| File | What's in it | Web version |
| --- | --- | --- |
| `Scripts/Core/Tunables.cs` | Every number: guns, parts, survivors, zombies, the director | `src/config.js` |
| `Scripts/Core/Game.cs` | Set-up, the frame loop, the survivor, auto-aim, camera, lights | `src/game.js` |
| `Scripts/Core/Game.Zombies.cs` | Spawning, chasing, attacking, dying | `src/game.js` |
| `Scripts/Core/Game.Combat.cs` | Firing, bullets, grenades, explosions, blood | `src/game.js` |
| `Scripts/Combat/Weapon.cs` | A gun's stats from its parts, ammo, reloads, recoil | `src/weapons.js` |
| `Scripts/Combat/Director.cs` | Who spawns, where and when, from the distance | `src/director.js` |
| `Scripts/World/Road.cs` | The endless street in 32 m chunks | `src/world.js` |
| `Scripts/Actors/Humanoid.cs` | Survivors and zombies (box people for now) | `src/models.js` |
| `Scripts/Core/StickInput.cs` | The floating joystick, any number of fingers | `src/input.js` |
| `Scripts/UI/Hud.cs` + `Resources/UI/Graveway.uss` | HUD, menu, pause, results (UI Toolkit) | `src/ui.js`, `index.html` |
| `Scripts/Core/Art.cs` | Materials, meshes and textures made in code | `src/models.js` |
| `Scripts/Core/Save.cs` | Progress in PlayerPrefs | `src/save.js` |
| `Editor/ProjectSetup.cs` | First-open setup (menu: Graveway → Set up project) | `tools/android/build-apk.mjs` |

Coordinates: **+z is up the road**, +x is right, y is up. The survivor
starts at z = 0. (The web version runs the other way, toward −z.)

It works in the Built-in render pipeline as it is, and in URP if you add
it: materials pick the matching shader.

## Porting roadmap

Done in this first slice:

- [x] Every tunable from `config.js`, including gun parts
- [x] The endless street: chunks, buildings, alleys, lamps, litter, the start barricade
- [x] Survivors (all four) with their stats, perks and signature guns
- [x] Floating joystick with multi-finger hand-off, keyboard in the editor
- [x] Auto-aim, firing, spread and recoil, reloads, weapon switching
- [x] Bullets swept per frame with pierce; grenades and explosions that throw zombies
- [x] Zombies: walker, runner, tank, boss; wander, chase, attack, death fall
- [x] The Director: stages, hordes, stragglers, alley ambushes, bosses
- [x] HUD (distance, stage, coins, health, armor, ammo, weapon bar, boss bar), menu with survivor pick, pause, results
- [x] Saving coins, best distance, runs and kills

Next, roughly in this order:

- [ ] **Props and destruction**: cars, tanker, barricades, barrels, walls, lamps, fire barrels, condemned buildings (`props.js`), with bullets stopping at them
- [ ] **Pathfinding**: the flow-field nav grid zombies use to go round wreckage (`nav.js`)
- [ ] **Coins and pickups** on the road with the magnet; health and armor
- [ ] **Power-ups** (`POWERUPS` in config)
- [ ] **Fog of war** (`fog.js`)
- [ ] **Effects**: fireballs, smoke columns, debris, scorch marks (`vfx.js`), as Unity particle systems
- [ ] **Sound**: the synthesised effects (`audio.js`), or real recordings
- [ ] **Armory**: buying guns, loadout, gun parts with the gun preview, survivor upgrades
- [ ] **Survivor select** screen with portraits
- [ ] **Playtest tools and notes** (Send to Claude)
- [ ] **Real art**: rigged characters and animations (Mixamo, Asset Store packs), proper guns, URP lighting
- [ ] **Cloud builds**: building the APK on GitHub Actions (needs a Unity licence added as repository secrets)

## Updates on the phone

The web version's Android app updates itself, because its game is web
files it can download. A Unity game is compiled into the app, so new
builds need installing again. Two ways to make that painless later: the
Google Play internal testing track (the Play Store updates it for you;
needs a Play developer account), or an in-app "update ready" prompt that
downloads the new APK, after which Android still asks you to tap Install.
