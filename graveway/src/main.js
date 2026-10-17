import { Game } from './game.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { unlockAudio } from './audio.js';
import { save } from './save.js';

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
ui.attach(game, input);
game.showMenu();

// Sound may only start after the first tap or key press.
window.addEventListener('pointerdown', unlockAudio, { capture: true });
window.addEventListener('keydown', unlockAudio, { capture: true });

// Long-presses shouldn't open menus or select text mid-fight.
document.addEventListener('contextmenu', (e) => e.preventDefault());

// Leaving the app pauses the game, so you don't come back to a corpse.
document.addEventListener('visibilitychange', () => { if (document.hidden) ui.pause(); });

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  game.update(dt, input);
  game.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Offline play once the game has loaded once.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// Handy from the browser console while tuning: graveway.game.player.hp = 999
window.graveway = { game, ui, save };
document.documentElement.dataset.ready = '1';
