import { WEAPONS, LOADOUT_SLOTS } from './config.js';

/* Progress lives in localStorage on this device. Storage can be missing or
   throw (private browsing, blocked site data), so every access is guarded and
   the game still runs — it just forgets between visits. */

// v2: endless runs replaced levels. A v1 save is simply ignored.
const KEY = 'graveway.save.v2';

const defaults = () => ({
  coins: 0,
  best: 0,              // furthest run, metres
  runs: 0,
  kills: 0,
  character: 'rook',    // survivor picked last time
  owned: ['pistol'],    // guns bought in the Armory
  loadout: null,        // guns equipped to carry, besides the survivor's own; null until first chosen
  wup: {},              // weapon upgrades, e.g. { smg: { damage: 2 } }
  pup: {},              // survivor upgrades, e.g. { maxHp: 1 }
  settings: { sound: true, haptics: true, quality: 'high', god: false, fps: false, startAt: 0, powers: false },
});

function merge(base, stored) {
  for (const k of Object.keys(base)) {
    if (!(k in stored)) continue;
    const b = base[k], s = stored[k];
    if (b && typeof b === 'object' && !Array.isArray(b) && s && typeof s === 'object' && Object.keys(b).length) {
      merge(b, s);
    } else if (typeof s === typeof b || (b && typeof b === 'object')) {
      base[k] = s;
    }
  }
  return base;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return merge(defaults(), JSON.parse(raw));
  } catch { /* fall through to a fresh save */ }
  return defaults();
}

export const save = load();

export function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* storage unavailable */ }
}

export function resetSave() {
  const keep = save.settings;
  for (const k of Object.keys(save)) delete save[k];
  Object.assign(save, defaults(), { settings: keep });
  persist();
}

export const weaponUps = (id) => save.wup[id] || (save.wup[id] = {});

/* The guns equipped in the Armory: up to LOADOUT_SLOTS - 1, carried besides
   the survivor's own. Until you first choose, it's your priciest guns. */
export function loadout() {
  if (!Array.isArray(save.loadout)) {
    const owned = WEAPONS.filter((w) => save.owned.includes(w.id)).sort((a, b) => b.price - a.price);
    save.loadout = owned.slice(0, LOADOUT_SLOTS - 1).map((w) => w.id);
  }
  return save.loadout;
}

/* What a survivor carries into a run: their own gun first, then the
   equipped ones in Armory order. */
export function runWeapons(character) {
  const eq = loadout();
  const own = character.startingWeapon;
  return [own, ...WEAPONS.map((w) => w.id).filter((id) => id !== own && eq.includes(id) && save.owned.includes(id))];
}

/* Playtest notes are kept apart from progress, so "Reset progress" doesn't
   throw away feedback. (Uninstalling the app still clears both.) */
const NOTES_KEY = 'graveway.notes.v1';

function loadNotes() {
  try {
    const a = JSON.parse(localStorage.getItem(NOTES_KEY) || '[]');
    return Array.isArray(a) ? a : [];
  } catch { return []; }
}

export const notes = loadNotes();

export function persistNotes() {
  try { localStorage.setItem(NOTES_KEY, JSON.stringify(notes)); } catch { /* storage unavailable */ }
}
