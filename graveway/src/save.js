/* Progress lives in localStorage on this device. Storage can be missing or
   throw (private browsing, blocked site data), so every access is guarded and
   the game still runs — it just forgets between visits. */

const KEY = 'graveway.save.v1';

const defaults = () => ({
  coins: 0,
  unlocked: 1,          // highest level you may start
  level: 1,             // level picked on the menu
  kills: 0,
  owned: ['pistol'],
  equipped: 'pistol',   // the gun you start each level holding
  wup: {},              // weapon upgrades, e.g. { smg: { damage: 2 } }
  pup: {},              // survivor upgrades, e.g. { maxHp: 1 }
  settings: { sound: true, haptics: true, quality: 'high' },
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
