// Thin fetch wrappers. Same-origin in production; Vite proxies /api in dev.

async function json(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  cameras: () => json("/api/cameras"),
  updateCamera: (id, prefs) =>
    json(`/api/cameras/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prefs),
    }),
  liveSource: (id) => json(`/api/cameras/${encodeURIComponent(id)}/live`),
  snapshotUrl: (id, bust = Date.now()) => `/api/cameras/${encodeURIComponent(id)}/snapshot?t=${bust}`,
  events: (params = {}) => json(`/api/events?${new URLSearchParams(params)}`),
  eventSnapshotUrl: (id) => `/api/events/${id}/snapshot`,
  status: () => json("/api/status"),
  /** Subscribe to new events. Returns an unsubscribe function. */
  onEvent(cb) {
    const es = new EventSource("/api/events/stream");
    es.addEventListener("camera-event", (e) => cb(JSON.parse(e.data)));
    return () => es.close();
  },
};
