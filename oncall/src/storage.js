/**
 * The app persists through `window.storage`, which exists inside Claude
 * artifacts but not in a browser. This shim backs it with localStorage so the
 * same component runs unchanged in both places.
 *
 * When you move to a real backend, replace the body of these four functions
 * with fetch() calls. Nothing in OnCallApp.jsx needs to change: it stores one
 * session key plus one key per organization (`oncall_db_<orgId>_v2`).
 */
const memory = new Map();

const backend = (() => {
  try {
    const probe = "__oncall_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch (e) {
    // Private mode or storage disabled — fall back to memory for this session.
    return {
      getItem: (k) => (memory.has(k) ? memory.get(k) : null),
      setItem: (k, v) => memory.set(k, v),
      removeItem: (k) => memory.delete(k),
      key: (i) => Array.from(memory.keys())[i] ?? null,
      get length() {
        return memory.size;
      },
    };
  }
})();

export function installStorageShim() {
  if (typeof window === "undefined" || window.storage) return;

  window.storage = {
    async get(key) {
      const value = backend.getItem(key);
      return value === null ? null : { key, value, shared: false };
    },
    async set(key, value) {
      backend.setItem(key, String(value));
      return { key, value, shared: false };
    },
    async delete(key) {
      backend.removeItem(key);
      return { key, deleted: true, shared: false };
    },
    async list(prefix = "") {
      const keys = [];
      for (let i = 0; i < backend.length; i += 1) {
        const k = backend.key(i);
        if (k && k.startsWith(prefix)) keys.push(k);
      }
      return { keys, prefix, shared: false };
    },
  };
}
