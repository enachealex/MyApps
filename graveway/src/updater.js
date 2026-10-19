/* Live updates for the Android app: new game files without a reinstall.

   Every cloud build attaches graveway-web-<native>.json.gz to its GitHub
   Release: every web file of the game, gzipped (see the top of
   tools/android/build-apk.mjs). On startup the app asks GitHub for the
   newest release, and if it's a later build made for the same native side
   (same Capacitor plugins and permissions, which is what <native> hashes),
   it downloads it, unpacks it into the app's own storage and restarts into
   it. Saves and notes live in localStorage, which stays put.

   Everything goes through plugins that ship with Capacitor, called over its
   bridge like the App plugin in main.js:
     CapacitorHttp  the download (GitHub's download links don't allow a
                    browser fetch, so it has to be native)
     Filesystem     writing the files
     WebView        pointing the app at them (setServerBasePath), and
                    remembering that across launches (persistServerBasePath)

   Safety: a new build is only remembered once it has started and drawn a
   few frames (confirm). If it never gets that far, nothing was persisted,
   so the next launch is back on the build that worked. That one tries the
   new build once more (in case the app was just closed at the wrong
   moment), and after a second failure skips it for good. Installing an
   APK always starts from the files inside it: Capacitor forgets the
   switched path whenever the app's version changes. */

import { UPDATE_REPO } from './config.js';

const KEY = 'graveway.update.v1';     // { trying, lastTried, tries, bad: [builds] }
const DIR = 'live';                    // under the app's files directory
const API = `https://api.github.com/repos/${UPDATE_REPO}/releases?per_page=30`;

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { trying: s.trying || null, lastTried: s.lastTried || null, tries: s.tries || 0, bad: Array.isArray(s.bad) ? s.bad : [] };
  } catch { return { trying: null, lastTried: null, tries: 0, bad: [] }; }
}

export class Updater {
  constructor(native) {
    this.native = native;            // window.Capacitor inside the app, else null
    this.info = null;                // this build's build.json
    this.live = false;               // running downloaded files, not the APK's own
    this.enabled = false;
    this.busy = false;
    this.ready = null;               // a downloaded build waiting to be switched to
    this.newApp = null;              // a newer release that needs a new APK
    this.status = '';
    this.onChange = () => {};
    this.state = loadState();
  }

  call(plugin, method, opts = {}) { return this.native.nativePromise(plugin, method, opts); }

  saveState() {
    try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch { /* storage unavailable */ }
  }

  set(status) {
    this.status = status;
    this.onChange();
  }

  /* Which build is this, and is updating possible here? */
  async init() {
    try { this.info = await (await fetch('build.json', { cache: 'no-store' })).json(); } catch { this.info = null; }
    const has = (n) => !!this.native?.PluginHeaders?.some((h) => h.name === n);
    this.enabled = !!(this.info && has('Filesystem') && has('WebView') && has('CapacitorHttp'));
    if (!this.enabled) return;
    try {
      const { path } = await this.call('WebView', 'getServerBasePath');
      this.live = typeof path === 'string' && path.includes(`/${DIR}/`);
    } catch { this.live = false; }
    // A build we switched to last time that isn't the one running now never
    // got as far as confirm(). Twice, and it's broken: leave it alone.
    const t = this.state.trying;
    if (t && t !== this.info.build) {
      if (this.state.tries >= 2 && !this.state.bad.includes(t)) this.state.bad.push(t);
      this.state.trying = null;
      this.saveState();
    }
  }

  /* Called once the game is up and drawing: from now on, launches start on
     the files this build was loaded from. */
  async confirm() {
    if (!this.enabled) return;
    if (this.state.trying === this.info.build) {
      this.state.trying = null;
      this.state.tries = 0;
      this.saveState();
    }
    try {
      // For the APK's own files this stores 'public', which Capacitor reads
      // as "the files inside the APK".
      await this.call('WebView', 'persistServerBasePath');
      // Throw away every other downloaded build.
      const { files } = await this.call('Filesystem', 'readdir', { path: DIR, directory: 'DATA' });
      for (const f of files || []) {
        const name = typeof f === 'string' ? f : f.name;
        if (!this.live || Number(name) !== this.info.build) {
          await this.call('Filesystem', 'rmdir', { path: `${DIR}/${name}`, directory: 'DATA', recursive: true }).catch(() => {});
        }
      }
    } catch { /* no live/ folder yet */ }
  }

  /* Looks for a newer build and downloads it. Resolves to the build that's
     ready to switch to, or null. Quiet unless `manual`. */
  async check({ manual = false } = {}) {
    if (!this.enabled || this.busy) return this.ready;
    if (!this.info.build && !manual) return null;     // a local USB build: leave it alone
    this.busy = true;
    try {
      this.set('Checking…');
      const res = await fetch(API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
      if (!res.ok) throw new Error(res.status === 403 ? 'GitHub says try again later' : `GitHub said ${res.status}`);
      const releases = await res.json();
      const app = this.info.app || 'graveway';
      const want = `${app}-web-${this.info.native}.json.gz`;
      const pkg = new RegExp(`^${app}-web-[0-9a-f]+\\.json\\.gz$`);
      let best = null, newest = null;
      for (const r of releases) {
        const m = new RegExp(`^${app}-v(.+)-(\\d+)$`).exec(r.tag_name || '');
        if (!m || r.draft) continue;
        const build = Number(m[2]), version = m[1];
        if (build <= this.info.build) continue;
        const assets = r.assets || [];
        const asset = assets.find((a) => a.name === want);
        if (asset && !this.state.bad.includes(build) && (!best || build > best.build)) best = { build, version, asset, page: r.html_url };
        // Newer, but only for a different native side (or no package at all).
        if (!asset && assets.some((a) => pkg.test(a.name) || a.name.endsWith('.apk')) && (!newest || build > newest.build)) {
          newest = { build, version, page: r.html_url };
        }
      }
      this.newApp = newest && (!best || newest.build > best.build) ? newest : null;
      if (!best) {
        this.set(this.newApp ? `New app version ${this.newApp.version} to install` : 'Up to date');
        return null;
      }
      if (this.ready && this.ready.build === best.build) return this.ready;
      this.set(`Downloading ${best.version}…`);
      this.ready = await this.download(best);
      this.set(`${best.version} (build ${best.build}) ready`);
      return this.ready;
    } catch (err) {
      this.set(manual ? `Couldn't check: ${err.message || err}` : 'Couldn\'t check for updates');
      return null;
    } finally {
      this.busy = false;
      this.onChange();
    }
  }

  async download(rel) {
    const r = await this.call('CapacitorHttp', 'request', {
      url: rel.asset.browser_download_url, method: 'GET', responseType: 'blob',
      headers: { Accept: 'application/octet-stream' }, connectTimeout: 20000, readTimeout: 60000,
    });
    if (r.status !== 200 || typeof r.data !== 'string') throw new Error(`download failed (${r.status})`);
    const bin = atob(r.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    // GitHub lists a SHA-256 for every release file: a cut-short or mangled
    // download stops here.
    const want = /^sha256:([0-9a-f]{64})$/.exec(rel.asset.digest || '');
    if (want && crypto.subtle) {
      const got = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
      if (got !== want[1]) throw new Error('the download was damaged');
    }
    const text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    const pkg = JSON.parse(text);
    if (pkg.build !== rel.build || pkg.native !== this.info.native || !pkg.files?.some((f) => f[0] === 'index.html')) {
      throw new Error('the download didn\'t match');
    }
    const dir = `${DIR}/${pkg.build}`;
    await this.call('Filesystem', 'rmdir', { path: dir, directory: 'DATA', recursive: true }).catch(() => {});
    for (const [path, kind, data] of pkg.files) {
      if (path.split('/').some((part) => part === '..' || part === '')) throw new Error('bad file name in the download');
      await this.call('Filesystem', 'writeFile', {
        path: `${dir}/${path}`, directory: 'DATA', data, recursive: true, ...(kind === 't' ? { encoding: 'utf8' } : {}),
      });
    }
    const { uri } = await this.call('Filesystem', 'getUri', { path: dir, directory: 'DATA' });
    return { build: pkg.build, version: pkg.version, path: decodeURI(uri.replace(/^file:\/\//, '')) };
  }

  /* Restarts the app on the downloaded build. */
  apply() {
    if (!this.ready) return;
    const b = this.ready.build;
    this.state.tries = this.state.lastTried === b ? this.state.tries + 1 : 1;
    this.state.lastTried = this.state.trying = b;
    this.saveState();
    this.call('WebView', 'setServerBasePath', { path: this.ready.path }).catch(() => {
      this.state.trying = null;
      this.saveState();
    });
  }

  /* Back to the files that came with the APK ('public' is where Capacitor
     keeps them). The build you were on is skipped from now on; a later one
     will still come through. The APK's build then persists itself in
     confirm(), like any other start. */
  revert() {
    if (!this.live) return;
    if (!this.state.bad.includes(this.info.build)) this.state.bad.push(this.info.build);
    this.state.trying = null;
    this.saveState();
    this.call('WebView', 'setServerAssetPath', { path: 'public' }).catch(() => {});
  }

  /* For Settings: "0.7 (build 9) · updated" */
  get label() {
    if (!this.info) return '';
    return `${this.info.version}${this.info.build ? ` (build ${this.info.build})` : ' (local build)'}${this.live ? ' · updated' : ''}`;
  }
}
