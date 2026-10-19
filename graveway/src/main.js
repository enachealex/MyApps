import { Game } from './game.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { unlockAudio } from './audio.js';
import { save } from './save.js';
import { Updater } from './updater.js';

// Inside the Android app, Capacitor injects its bridge before this runs. The
// game doesn't bundle Capacitor's JS, so it talks to the App plugin through
// the bridge's own calls rather than Capacitor.Plugins (which stays empty).
const native = window.Capacitor?.isNativePlatform?.() ? window.Capacitor : null;
const hasAppPlugin = !!native?.PluginHeaders?.some((h) => h.name === 'App');

// The safe-zone sign is painted with the display font, so wait for it (briefly).
if (document.fonts) {
  await Promise.race([document.fonts.load('72px "Bebas Neue"').catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
}

const canvas = document.getElementById('scene');
const ui = new UI();

let game;
try {
  game = new Game(canvas, ui.hooks);
} catch (err) {
  console.error(err);
  document.getElementById('nogl').hidden = false;
  document.getElementById('menu').hidden = true;
  throw err;
}

const input = new Input(document.getElementById('touch'), document.getElementById('joy'), document.getElementById('joy-knob'));
const updater = new Updater(native);
ui.attach(game, input);
ui.attachUpdater(updater);
game.showMenu();
// Survivor portraits are rendered from their 3D models once the menu is up.
setTimeout(() => ui.setPortraits(game.renderPortraits()), 300);

// Sound may only start after the first tap or key press.
window.addEventListener('pointerdown', unlockAudio, { capture: true });
window.addEventListener('keydown', unlockAudio, { capture: true });

// Long-presses shouldn't open menus or select text mid-fight (the note box
// still gets its paste menu).
document.addEventListener('contextmenu', (e) => { if (!e.target.closest('textarea')) e.preventDefault(); });

// Leaving the app pauses the game, so you don't come back to a corpse.
document.addEventListener('visibilitychange', () => { if (document.hidden) ui.pause(); });

/* Android app: the back button steps back through the game (pause, close a
   menu) instead of quitting mid-run, and only leaves from the main menu. */
if (hasAppPlugin) {
  native.addListener('App', 'backButton', () => ui.back());
  native.addListener('App', 'pause', () => ui.pause());
  ui.onExit = () => native.nativePromise('App', 'exitApp', {}).catch(() => {});
  native.nativePromise('App', 'getInfo', {})
    .then((info) => { if (!updater.info) ui.build = `v${info.version} (build ${info.build}) · Android`; })
    .catch(() => { if (!updater.info) ui.build = 'Android'; });
} else {
  ui.build = native ? 'Android' : 'Web';
}

/* Live updates (src/updater.js): once the game has drawn a few frames, this
   build counts as working; then look for a newer one. */
let frames = 0;
if (native) {
  updater.init().then(async () => {
    if (!updater.enabled) return;
    const i = updater.info;
    ui.build = `v${i.version} (build ${i.build}${updater.live ? ', updated' : ''}) · Android`;
    ui.renderUpdate();
    await new Promise((res) => { const wait = () => (frames >= 10 ? res() : setTimeout(wait, 100)); wait(); });
    await updater.confirm();
    if (await updater.check()) ui.updateReady();
    // Android can keep the app alive in the background for days, so look
    // again on coming back to it (at most every 15 minutes).
    let lastCheck = Date.now();
    if (hasAppPlugin) {
      native.addListener('App', 'resume', async () => {
        if (Date.now() - lastCheck < 15 * 60 * 1000) return;
        lastCheck = Date.now();
        if (await updater.check()) ui.updateReady();
      });
    }
  }).catch((err) => console.warn('update check failed', err));
}

let last = performance.now();
function frame(now) {
  frames++;
  const raw = (now - last) / 1000;
  last = now;
  if (raw > 0 && raw < 1) game.fps += (1 / raw - game.fps) * 0.05;
  game.update(Math.min(raw, 1 / 20), input);
  game.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Offline play once the game has loaded once. Not needed (or wanted) inside
// the Android app, which already has every file on the phone.
if (!native && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// Handy from the browser console while tuning: graveway.game.player.hp = 999
window.graveway = { game, ui, save, input, updater };
document.documentElement.dataset.ready = '1';
