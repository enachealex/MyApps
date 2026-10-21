# Combine Apps: the ArtCraft apps, two windows instead of twelve

The [ArtCraft open-source suite](https://ariacodez.ai/resources/artcraft-open-source-suite) is
twelve separate desktop apps (PhotoCraft, WordCraft, …), each in its own repository under
[github.com/storytold](https://github.com/storytold), normally installed and started one by one
from the [ArtCraft launcher](https://github.com/storytold/craft-launcher).

This folder builds them into **two** apps, grouped by what they do. Each app sits behind a tab in
the window's title bar; clicking a tab switches to it instantly, and whatever you were doing in
the other apps is still there when you come back.

| Window | Tabs |
| --- | --- |
| **ArtCraft Studio** (`craft-studio`): photo, video, audio and design | PhotoCraft · LightCraft · VectorCraft · FilmCraft · EffectCraft · SoundCraft · CADCraft |
| **ArtCraft Docs** (`craft-docs`): writing, data and documents | WordCraft · GridCraft · DeckCraft · PdfCraft · DesignCraft |

The apps are the real upstream apps, not copies: this repository pins each one to an exact commit
(`upstream.lock`), builds it from source, and adds only the code that hosts it in a tab.

Each window opens on its **Home** tab, which lists its apps with the version of each and checks
GitHub for newer releases at start-up. An app with a newer release gets an **Update** button, and
the Home tab shows how many updates are waiting from any other tab (see [Updating the
apps](#updating-the-apps)).

## Build and run

You need [Rust](https://rustup.rs) 1.95 or newer and git.

```bash
./scripts/build.ps1        # or scripts/build.sh
```

This checks the apps out into `vendor/` (`scripts/fetch-upstream.*`), builds both windows, and
puts the two programs in `dist/`: `craft-studio.exe` and `craft-docs.exe`. They need nothing
else; copy them anywhere.

The first build compiles about 2.5 million lines of Rust and takes about 20 minutes. Its cache in
`target/` (about 7 GB) makes later builds take minutes; `./scripts/build.ps1 -Clean` (or
`cargo clean`) deletes it afterwards, at the cost of a full build next time. Debug builds
(`cargo build`, `cargo test`) keep their own cache in `target/debug`, which is safe to delete too.

### Command line

```
craft-studio [--tab <app>] [--no-settings] [--screenshot-all <folder>] [--update <app,…>|all] [files…]
```

- **files**: each opens in the app that handles its type (`craft-docs report.docx budget.xlsx`
  opens WordCraft and GridCraft), and the window starts on the first one's tab.
- `--tab photocraft`: start on that tab (the ids are the lowercase app names; `home` is Home).
- `--no-settings`: start every app as on a fresh install and save nothing: no preferences, recent
  files or window layout are read or written.
- `--screenshot-all <folder>`: open every tab in turn, save a screenshot of each to the folder
  with a `report.txt`, then close. A quick check that every app starts inside the window.
- `--update photocraft,lightcraft` or `--update all`: what the Home tab's Update buttons do,
  without opening the window (progress on standard error).

`CRAFT_LOG=debug` makes the log more detailed. The log is in the settings folder (below), under
`logs/`.

## How it fits together

```
upstream.lock          the twelve apps (and the launcher, for its icons; craft-fonts) at exact commits
scripts/fetch-upstream checks them out into vendor/, then applies patches/<app>/*.patch
patches/               the few source changes the apps need to build together (each explained inside)
crates/craft-suite     the window: title-bar tabs, switching, settings, closing, GPU set-up,
                       and the Home tab with its update checks and update builds
crates/host-<app>      one per app: starts that app the way its own main.rs does, inside a tab
apps/craft-studio      the Studio window: which tabs, in which order
apps/craft-docs        the Docs window
```

All twelve apps are built on the same toolkit (egui / eframe 0.36, drawing with wgpu), which is
what makes one window possible: they share the window, one GPU device and one egui context.

- **Each app keeps its own look and state.** egui keeps an app's theme, zoom, fonts, panel sizes
  and popups in the context; the suite keeps one set per app and swaps it in with the tab, so
  WordCraft's light theme never leaks into PhotoCraft's dark one.
- **Only the app on screen runs.** The others are paused exactly where they were, the way an app
  pauses while its window is minimized. Work an app does on its own threads keeps going; anything
  it only does while its window is being drawn waits until you switch back to it.
- **Apps start the first time their tab is opened**, so a tab you never use costs nothing.
- **Closing the window asks every open app** about unsaved work, one after the other, with the
  app's own "save changes?" prompt. Any of them can cancel the close.
- **One app crashing doesn't take the others down.** Its tab shows what went wrong; the rest keep
  working.
- **Files dropped on the window** go to the app that opens them, switching tabs if needed.
- **Apps hand work to each other.** LightCraft's *Photo ▸ Edit In ▸ PhotoCraft* opens the photo
  in the PhotoCraft tab instead of starting a separate PhotoCraft.

### Settings

Most apps read and write their preferences, recent files, presets and recovery files exactly where
the standalone app does, so they are shared with a standalone install. Three apps keep some of
theirs in eframe's own storage file (PdfCraft: preferences, recent files, signatures; CADCraft: its
Options profile; PhotoCraft: its panel layout). In the suite those live in the suite's folder, and
start as a copy of the standalone app's the first time the app runs there.

The suite keeps its window position, the last tab and each app's layout in its own folder:
`%APPDATA%\artcraft-studio\data` and `%APPDATA%\artcraft-docs\data` on Windows
(`~/.local/share/…` on Linux, `~/Library/Application Support/…` on macOS).

### What differs from the standalone apps

The window, the GPU and the log belong to the suite, so the parts of each app's start-up that
dealt with those are left out (each `crates/host-<app>/src/lib.rs` lists exactly what, at the top):

- **Graphics start-up.** One GPU device serves every app, picked and configured with the drivers'
  known problems in mind (`crates/craft-suite/src/gpu.rs`). The apps' own graphics-backend
  preferences and their crash-recovery fallbacks (starting again on another backend or in a
  CPU-only mode) don't apply; `WGPU_BACKEND=dx12|vulkan|gl` still chooses the backend. Each app's
  own CPU fallback for its canvas still works.
- **The title bar** is the suite's: apps that draw their own (PhotoCraft, VectorCraft, LightCraft,
  PdfCraft…) draw their usual menus below it instead.
- **No `--control` automation servers** and no per-app command-line options.
- **macOS:** the menus stay inside the window (one menu bar can't belong to several apps), and
  files opened from Finder go through the command line, not Apple events.
- **VectorCraft on Windows** doesn't list fonts that are only registered with DirectWrite and
  live outside the Fonts folders (reading those needs code this repository doesn't allow).
- **One log** (`logs/` in the suite's settings folder) instead of one per app; EffectCraft's
  *Help ▸ Enable Logging* has no file of its own to write.

## Updating the apps

The upstream apps publish a release every few days. `upstream.lock` records, beside each app's
commit, the release it is (`v0.10.0`) or follows (`v0.7.0+`: changes made after v0.7.0).

**From the Home tab.** At start-up each window looks up every app's newest release (`git ls-remote`,
so no GitHub account or rate limit is involved). Clicking an app's **Update** button, or
**Update all**, rebuilds the window from this folder in the background while you keep working:

1. the app's line in `upstream.lock` is set to the release,
2. its source is checked out (`scripts/fetch-upstream`),
3. the window is built (`cargo build --release`, about 20 minutes, needing ~7 GB while it runs),
4. the new program goes into `dist/`,
5. the build cache is deleted again.

Then **Restart now** closes the window the usual way (each app asks about unsaved work) and opens
the new one. If a step fails, typically because the new release changed how the app starts up
and its host crate needs a change, `upstream.lock` and the source go back to what they were, the
Home tab says why, and nothing else changes. Updating needs this folder where it was built and
Rust installed; `upstream.lock` is left changed, for you to commit.

**By hand.** Put the new commit and version in `upstream.lock`, run
`scripts/fetch-upstream.ps1 -Only <app>`, then `cargo build` and `cargo test -p host-<app>`. If the
app changed how it starts up (`vendor/<app>/apps/<app>/src/main.rs`), bring `crates/host-<app>` in
line with it. If a patch in `patches/<app>` no longer applies, check whether upstream fixed the
problem and drop or redo it.

## Licences

The upstream apps are © their authors, under MIT OR Apache-2.0 (see each repository under
`vendor/`). Code in `crates/` that is adapted from an app says so at the top, with the source.
This repository's own code is under the same MIT OR Apache-2.0 terms.
