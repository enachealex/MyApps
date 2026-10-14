import { useEffect, useState } from "react";
import { Bell, ImageOff, Package, PersonStanding, Video } from "lucide-react";
import { api } from "../api.js";

const ICONS = { motion: Video, person: PersonStanding, package: Package };

export default function EventsList({ cameras, selectedId, onOpenLive }) {
  const [events, setEvents] = useState([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .events(filter ? { camera: filter, limit: 100 } : { limit: 100 })
      .then((rows) => !cancelled && setEvents(rows))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [filter]);

  useEffect(() => {
    return api.onEvent((ev) => {
      if (!filter || ev.cameraId === filter) setEvents((list) => [ev, ...list].slice(0, 200));
    });
  }, [filter]);

  useEffect(() => {
    if (!selectedId) return;
    document.getElementById(`event-${selectedId}`)?.scrollIntoView({ block: "center" });
  }, [selectedId, events.length]);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-lg border border-ink-600 bg-ink-800 px-2 py-1.5 text-sm"
        >
          <option value="">All cameras</option>
          {cameras.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-400">{events.length} event{events.length === 1 ? "" : "s"}</span>
      </div>

      {error && <p className="text-sm text-red-300">{error}</p>}
      {events.length === 0 && !error && (
        <div className="rounded-xl border border-dashed border-ink-600 p-8 text-center text-sm text-slate-400">
          <Bell className="mx-auto mb-2 opacity-60" />
          No events yet. They show up here the moment a camera reports motion.
        </div>
      )}

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {events.map((ev) => {
          const Icon = ICONS[ev.type] || Bell;
          const selected = String(ev.id) === String(selectedId);
          return (
            <li
              key={ev.id}
              id={`event-${ev.id}`}
              className={`overflow-hidden rounded-xl bg-ink-800 ring-1 ${selected ? "ring-accent" : "ring-ink-700"}`}
            >
              <button onClick={() => onOpenLive(ev.cameraId)} className="block w-full text-left">
                <div className="aspect-video bg-ink-900">
                  {ev.hasSnapshot ? (
                    <img src={api.eventSnapshotUrl(ev.id)} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-slate-600">
                      <ImageOff size={24} />
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="flex items-center gap-2 text-sm">
                    <Icon size={15} className="text-accent" />
                    <span className="capitalize">{ev.type}</span>
                    <span className="text-slate-400">· {ev.cameraName}</span>
                  </span>
                  <time className="text-[11px] text-slate-400" dateTime={new Date(ev.at).toISOString()}>
                    {formatWhen(ev.at)}
                  </time>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function formatWhen(ts) {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return sameDay ? time : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}
