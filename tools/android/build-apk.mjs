#!/usr/bin/env node
/* Builds an Android APK from one of this repo's web-app folders, and can
   install it straight onto a phone plugged in over USB.

     node tools/android/build-apk.mjs graveway --install

   It works the same on Windows, macOS and Linux, and it's what the GitHub
   "Build Android APK" workflow runs too, so a local build and a cloud build
   come out the same.

   What it does:
     1. Reads <folder>/android.json (app ID, name, colours, orientation,
        full-screen, permissions, extra Capacitor plugins). See the comment
        at the top of .github/workflows/android.yml for every key.
     2. Sets up a Capacitor 7 project in .android-build/<folder>/ (kept
        between builds, so the second build is much faster), copies the app
        in, and applies those settings to the Android project.
     3. Runs Gradle to produce a debug APK, and copies it to
        dist-android/<folder>-<version>.apk.
     4. With --install, runs `adb install -r` on it (and --launch opens it).

   Options:
     --version 0.1      versionName shown in Android settings (default 0.1)
     --code N           versionCode; defaults to minutes since 2024, so every
                        build counts as newer than the last
     --install          adb install -r the APK when it's built
     --launch           open the app after installing
     --clean            throw away .android-build/<folder> and start fresh
     --no-gradle        stop before Gradle (checks the setup without an SDK)

   Needs: Node 20+, JDK 21, and the Android SDK (ANDROID_HOME set, or
   Android Studio's default location). See graveway/ANDROID.md.            */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WIN = process.platform === 'win32';
const MIN_SDK = 24;

/* ── Arguments ─────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const app = argv.find((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && ['version', 'code'].includes(argv[i - 1].slice(2))));
if (!app) {
  console.error('Usage: node tools/android/build-apk.mjs <app-folder> [--install] [--launch] [--version 0.1] [--clean]');
  process.exit(1);
}
const version = opt('version', '0.1');
const code = Number(opt('code', Math.floor((Date.now() - Date.UTC(2024, 0, 1)) / 60000)));

const appDir = path.join(ROOT, app);
if (!fs.existsSync(path.join(appDir, 'index.html'))) fail(`No index.html in ${app}/. Check the folder name.`);

/* ── Settings ──────────────────────────────────────────────────────────── */
const rawCfg = fs.existsSync(path.join(appDir, 'android.json'))
  ? JSON.parse(fs.readFileSync(path.join(appDir, 'android.json'), 'utf8')) : {};
const slug = app.toLowerCase().replace(/[^a-z0-9]/g, '');
const cfg = {
  appId: rawCfg.appId || `com.thejumpvault.${slug}`,
  appName: rawCfg.appName || app,
  background: rawCfg.background || '#000000',
  orientation: rawCfg.orientation || '',
  fullscreen: !!rawCfg.fullscreen,
  permissions: rawCfg.permissions || [],
  plugins: rawCfg.plugins || [],
  prerelease: !!rawCfg.prerelease,
};
step(`${cfg.appName} (${cfg.appId}) ${version}, versionCode ${code}`);

/* ── Project ───────────────────────────────────────────────────────────── */
const work = path.join(ROOT, '.android-build', slug);
if (flag('clean')) fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

step('Copying the app');
const www = path.join(work, 'www');
fs.rmSync(www, { recursive: true, force: true });
fs.cpSync(appDir, www, { recursive: true });
for (const f of ['android.json', 'README.md', 'ANDROID.md']) fs.rmSync(path.join(www, f), { force: true });
fs.rmSync(path.join(work, 'assets'), { recursive: true, force: true });
if (fs.existsSync(path.join(appDir, 'assets'))) fs.cpSync(path.join(appDir, 'assets'), path.join(work, 'assets'), { recursive: true });

const deps = ['@capacitor/core@^7', '@capacitor/android@^7', ...cfg.plugins];
const devDeps = ['@capacitor/cli@^7', '@capacitor/assets@^3'];
const stamp = path.join(work, '.deps');
const want = JSON.stringify([deps, devDeps]);
if (!fs.existsSync(stamp) || fs.readFileSync(stamp, 'utf8') !== want) {
  step('Installing Capacitor');
  if (!fs.existsSync(path.join(work, 'package.json'))) {
    fs.writeFileSync(path.join(work, 'package.json'), JSON.stringify({ name: `${slug}-android`, private: true, version: '0.0.0' }, null, 2));
  }
  run('npm', ['install', '--no-fund', '--no-audit', ...deps], work);
  run('npm', ['install', '--no-fund', '--no-audit', '-D', ...devDeps], work);
  fs.writeFileSync(stamp, want);
}

fs.writeFileSync(path.join(work, 'capacitor.config.json'), JSON.stringify({
  appId: cfg.appId,
  appName: cfg.appName,
  webDir: 'www',
  android: { backgroundColor: cfg.background },
  server: { androidScheme: 'https' },
}, null, 2));

const android = path.join(work, 'android');
// A project left half-made by an interrupted run is thrown away and redone.
if (fs.existsSync(android) && !fs.existsSync(path.join(android, 'app', 'build.gradle'))) {
  fs.rmSync(android, { recursive: true, force: true });
}
if (!fs.existsSync(android)) {
  step('Creating the Android project');
  run('npx', ['cap', 'add', 'android'], work);
}

step('Applying android.json');
patch(path.join(android, 'variables.gradle'), (x) => x.replace(/minSdkVersion\s*=\s*\d+/, `minSdkVersion = ${MIN_SDK}`));
patch(path.join(android, 'app', 'build.gradle'), (x) => x
  .replace(/versionName\s+"[^"]*"/, `versionName "${version}"`)
  .replace(/versionCode\s+\d+/, `versionCode ${code}`));
patch(path.join(android, 'app', 'src', 'main', 'AndroidManifest.xml'), (x) => {
  x = x.replace(/\s*android:screenOrientation="[^"]*"/, '');
  if (cfg.orientation) {
    if (!x.includes('android:name=".MainActivity"')) fail('MainActivity not found in the manifest');
    x = x.replace('android:name=".MainActivity"', `android:name=".MainActivity"\n            android:screenOrientation="${cfg.orientation}"`);
  }
  for (const p of cfg.permissions) {
    const tag = `<uses-permission android:name="android.permission.${p}" />`;
    if (!x.includes(tag)) x = x.replace('</manifest>', `    ${tag}\n</manifest>`);
  }
  return x;
});

// Full-screen: hide the status and navigation bars whenever the app has
// focus; a swipe from the edge brings them back for a moment.
const main = findFile(path.join(android, 'app', 'src', 'main', 'java'), 'MainActivity.java');
const pkg = fs.readFileSync(main, 'utf8').match(/^package\s+[\w.]+;/m)[0];
fs.writeFileSync(main, cfg.fullscreen ? `${pkg}

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (!hasFocus) return;
        WindowInsetsControllerCompat bars =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        bars.hide(WindowInsetsCompat.Type.systemBars());
    }
}
` : `${pkg}

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {}
`);

if (fs.existsSync(path.join(work, 'assets', 'icon.png'))) {
  step('Making launcher icons and splash screens');
  run('npx', ['@capacitor/assets', 'generate', '--android',
    '--iconBackgroundColor', cfg.background, '--splashBackgroundColor', cfg.background], work);
}

step('Copying web assets into the Android project');
run('npx', ['cap', 'sync', 'android'], work);

if (flag('no-gradle')) {
  step(`Stopped before Gradle (--no-gradle). The project is in ${path.relative(ROOT, android)}`);
  process.exit(0);
}

/* ── Build ─────────────────────────────────────────────────────────────── */
ensureSdk(android);
if (!WIN) fs.chmodSync(path.join(android, 'gradlew'), 0o755);
step('Building the APK with Gradle (the first build downloads a lot)');
run(WIN ? 'gradlew.bat' : './gradlew', ['assembleDebug', '--no-daemon', '--stacktrace'], android, { localBin: true });

const built = path.join(android, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const outDir = path.join(ROOT, 'dist-android');
fs.mkdirSync(outDir, { recursive: true });
const apk = path.join(outDir, `${slug}-${version}.apk`);
fs.copyFileSync(built, apk);
const mb = (fs.statSync(apk).size / 1048576).toFixed(1);
step(`APK ready: ${path.relative(ROOT, apk)} (${mb} MB)`);

// The GitHub workflow picks these up.
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, [
    `apk=${path.relative(ROOT, apk)}`, `app_name=${cfg.appName}`, `app_id=${cfg.appId}`,
    `slug=${slug}`, `prerelease=${cfg.prerelease}`,
  ].join('\n') + '\n');
}

if (flag('install') || flag('launch')) {
  step('Installing on the connected phone');
  const adb = findAdb();
  // adb is a real executable, so no shell: paths with spaces stay intact.
  const r = spawnSync(adb, ['install', '-r', apk], { encoding: 'utf8' });
  process.stdout.write(r.stdout || '');
  process.stderr.write(r.stderr || '');
  const out = `${r.stdout}\n${r.stderr}`;
  if (r.status !== 0 || /Failure|failed/i.test(out)) {
    if (/INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match/i.test(out)) {
      fail(`The phone has a copy signed with a different key (for example a cloud build).
Uninstall it first, which also clears its saved progress and notes:
  adb uninstall ${cfg.appId}
then run this again.`);
    }
    if (/no devices|device offline|unauthorized/i.test(out)) {
      fail('No phone ready. Plug it in, unlock it, allow USB debugging when asked, and check `adb devices`.');
    }
    fail('adb install failed (see above).');
  }
  if (flag('launch')) {
    spawnSync(adb, ['shell', 'monkey', '-p', cfg.appId, '-c', 'android.intent.category.LAUNCHER', '1'], { stdio: 'inherit' });
  }
  step('Installed.');
}

/* ── Helpers ───────────────────────────────────────────────────────────── */
function step(msg) { console.log(`\n▸ ${msg}`); }

function fail(msg) {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
}

function run(cmd, args, cwd, { localBin = false } = {}) {
  const r = spawnSync(localBin && !WIN ? path.join(cwd, cmd) : cmd, args, { cwd, stdio: 'inherit', shell: WIN });
  if (r.error) fail(`Couldn't run ${cmd}: ${r.error.message}`);
  if (r.status !== 0) fail(`${cmd} ${args.join(' ')} failed (exit ${r.status}).`);
}

function patch(file, fn) {
  const before = fs.readFileSync(file, 'utf8');
  const after = fn(before);
  if (after !== before) fs.writeFileSync(file, after);
}

function findFile(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const f = findFile(p, name); if (f) return f; }
    else if (e.name === name) return p;
  }
  return null;
}

function sdkDir() {
  const env = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (env && fs.existsSync(env)) return env;
  const guesses = WIN
    ? [path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk')]
    : process.platform === 'darwin'
      ? [path.join(os.homedir(), 'Library', 'Android', 'sdk')]
      : [path.join(os.homedir(), 'Android', 'Sdk'), '/usr/local/lib/android/sdk'];
  return guesses.find((g) => g && fs.existsSync(g)) || null;
}

/* Gradle needs to know where the SDK is: ANDROID_HOME, or local.properties. */
function ensureSdk(androidDir) {
  const lp = path.join(androidDir, 'local.properties');
  if (process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || fs.existsSync(lp)) return;
  const sdk = sdkDir();
  if (!sdk) {
    fail(`Can't find the Android SDK. Install Android Studio (or the command-line tools) and set
ANDROID_HOME to the SDK folder. See graveway/ANDROID.md.`);
  }
  fs.writeFileSync(lp, `sdk.dir=${sdk.replace(/\\/g, '\\\\')}\n`);
}

function findAdb() {
  const sdk = sdkDir();
  const inSdk = sdk && path.join(sdk, 'platform-tools', WIN ? 'adb.exe' : 'adb');
  return inSdk && fs.existsSync(inSdk) ? inSdk : 'adb';
}
