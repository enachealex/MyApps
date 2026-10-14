import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function StatusPage({ cameras, onCameraChange }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .status()
        .then((s) => !cancelled && setStatus(s))
        .catch((e) => !cancelled && setError(e.message));
    load();
    const t = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const toggleAlerts = async (cam) => {
    await api.updateCamera(cam.id, { alertsEnabled: !cam.prefs.alertsEnabled });
    onCameraChange();
  };

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Server</h2>
        {error && <p className="text-sm text-red-300">{error}</p>}
        {status && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl bg-ink-800 p-4 text-sm ring-1 ring-ink-700 sm:grid-cols-4">
            <Item label="Uptime" value={formatDuration(status.uptimeSec)} />
            <Item label="Cameras" value={status.cameras} />
            <Item label="Alerts" value={status.alertsEnabled ? "ntfy on" : "off"} />
            <Item label="Node" value={status.node} />
          </dl>
        )}
      </section>

      {status && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Adapters</h2>
          <div className="space-y-2">
            {Object.entries(status.adapters).map(([name, s]) => (
              <div key={name} className="rounded-xl bg-ink-800 p-4 text-sm ring-1 ring-ink-700">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-medium">{name}</span>
                  <span className={`text-xs ${s.startError ? "text-red-300" : "text-emerald-400"}`}>
                    {s.startError ? "failed" : "running"}
                  </span>
                </div>
                {s.startError && <p className="mb-2 text-xs text-red-300">{s.startError}</p>}
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                  {Object.entries(s)
                    .filter(([k]) => k !== "startError")
                    .map(([k, v]) => (
                      <Item key={k} label={k} value={formatValue(k, v)} />
                    ))}
                </dl>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Cameras</h2>
        <ul className="divide-y divide-ink-700 rounded-xl bg-ink-800 ring-1 ring-ink-700">
          {cameras.map((cam) => (
            <li key={cam.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <div>
                <div className="font-medium">{cam.name}</div>
                <div className="text-[11px] text-slate-400">
                  {cam.id}
                  {cam.privateIp ? ` · ${cam.privateIp}` : ""}
                  {cam.health ? ` · ${cam.health}` : ""}
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                Alerts
                <input type="checkbox" checked={cam.prefs?.alertsEnabled ?? true} onChange={() => toggleAlerts(cam)} className="accent-sky-400" />
              </label>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Item({ label, value }) {
  return (
    <>
      <dt className="text-slate-400">{label}</dt>
      <dd className="truncate text-slate-100">{String(value ?? "—")}</dd>
    </>
  );
}

function formatValue(key, v) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (/At$/.test(key) && typeof v === "number") return new Date(v).toLocaleString();
  return v;
}

function formatDuration(sec) {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h`;
}
