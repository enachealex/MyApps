import { useEffect, useState } from "react";
import { AlertTriangle, WifiOff } from "lucide-react";
import { api } from "../api.js";

const REFRESH_MS = 10_000;

export default function CameraGrid({ cameras, onOpen }) {
  if (cameras.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-ink-600 p-8 text-center text-sm text-slate-400">
        No cameras yet. Enable an adapter in <code className="text-slate-300">server/config.json</code>.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cameras.map((cam) => (
        <CameraTile key={cam.id} camera={cam} onOpen={() => onOpen(cam)} />
      ))}
    </div>
  );
}

export function CameraTile({ camera, onOpen }) {
  const [src, setSrc] = useState(() => api.snapshotUrl(camera.id));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!camera.supports.snapshot) return undefined;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") setSrc(api.snapshotUrl(camera.id));
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [camera.id, camera.supports.snapshot]);

  return (
    <button
      onClick={onOpen}
      className="group relative aspect-video overflow-hidden rounded-xl bg-ink-800 text-left ring-1 ring-ink-700 transition hover:ring-accent/60 focus:outline-none focus:ring-accent"
    >
      {camera.supports.snapshot && !failed ? (
        <img
          src={src}
          alt={camera.name}
          onError={() => setFailed(true)}
          onLoad={() => setFailed(false)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-slate-500">
          {failed ? <WifiOff size={28} /> : <span className="text-xs">No preview</span>}
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-6">
        <span className="text-sm font-medium drop-shadow">{camera.name}</span>
        <span className="flex items-center gap-1.5 text-[11px] text-slate-300">
          {camera.health && <AlertTriangle size={13} className="text-amber-400" />}
          <span className={`h-2 w-2 rounded-full ${camera.online ? "bg-emerald-400" : "bg-red-500"}`} />
          {camera.online ? "online" : "offline"}
        </span>
      </div>
    </button>
  );
}
