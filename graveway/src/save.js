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
  wup: {},              // weapon upgrades, e.g. { smg: { damage: 2 } }
  pup: {},              // survivor upgrades, e.g. { maxHp: 1 }
  settings: { sound: true, haptics: true, quality: 'high', god: false, fps: false, startAt: 0 },
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
