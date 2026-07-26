# MyApps

Small apps, one per folder, published together at
**https://myapps.thejumpvault.com/**.

| App | Folder | Live | Kind |
| --- | --- | --- | --- |
| My Apps landing page | [`index.html`](index.html) | / | static |
| Putt Count | [`puttcount/`](puttcount) | /puttcount/ | static |
| OnCall Schedule | [`oncall/`](oncall) | /oncall/ | Vite build |

## How deployment works

One workflow, [`.github/workflows/pages.yml`](.github/workflows/pages.yml),
builds every app, assembles them into a single `_site/` directory, and hands
that to GitHub Pages. It runs on every push to `main`.

Pages for this repo is configured with **Build type: GitHub Actions**, not
"Deploy from a branch". Pushing a `gh-pages` branch does nothing — only
`actions/deploy-pages` publishes.

To reproduce the deployed site locally:

```bash
cd oncall && npm ci && npm run build && cd ..
mkdir -p _site && cp index.html _site/ && cp -r puttcount _site/puttcount && cp -r oncall/dist _site/oncall
npx serve _site
```

## Adding another app

**Static app** — create `<folder>/index.html`, then add one line to the
assemble step in `pages.yml`:

```yaml
cp -r <folder> _site/<folder>
```

**Built app** — create `<folder>/` with its own `package.json`, set `base` in
its `vite.config.js` to `/<folder>/`, then add a build step and a
`cp -r <folder>/dist _site/<folder>` line.

Either way, add a tile to the `APPS` array in `index.html` so it shows up on
the landing page.

### The base path matters

The site is served from a custom domain, so its root is `/`. A built app's
`base` is `/<folder>/` — **not** `/MyApps/<folder>/`, which would only be
right when serving from the default `enachealex.github.io/MyApps/` URL.

## Android APKs

[`.github/workflows/android.yml`](.github/workflows/android.yml) wraps any
static app folder in Capacitor and attaches a debug APK to a Release. Run it
from **Actions → Build Android APK → Run workflow** and give it a folder name
(default `puttcount`). It picks up `<folder>/assets/icon.png` and
`splash.png` for launcher icons if they exist.

[`.github/workflows/android-apk.yml`](.github/workflows/android-apk.yml) does
the same for OnCall, which needs a Vite build first.
