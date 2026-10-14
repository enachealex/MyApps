import { useCallback, useEffect, useState } from "react";
import { Activity, Bell, Film, Video } from "lucide-react";
import { api } from "./api.js";
import CameraGrid from "./components/CameraGrid.jsx";
import EventsList from "./components/EventsList.jsx";
import LiveView from "./components/LiveView.jsx";
import RecordingsPage from "./components/RecordingsPage.jsx";
import StatusPage from "./components/StatusPage.jsx";

const TABS = [
  { id: "cameras", label: "Cameras", icon: Video },
  { id: "events", label: "Events", icon: Bell },
  { id: "recordings", label: "Recordings", icon: Film },
  { id: "status", label: "Status", icon: Activity },
];

/** Hash routes: #/cameras, #/events, #/events/:id, #/recordings, #/status, #/live/:cameraId */
function parseHash() {
  const parts = window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  return { tab: parts[0] || "cameras", arg: parts.slice(1).join("/") || null };
}

export default function App() {
  const [route, setRoute] = useState(parseHash);
  const [cameras, setCameras] = useState([]);
  const [error, setError] = useState(null);
  const [unseen, setUnseen] = useState(0);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const loadCameras = useCallback(async () => {
    try {
      setCameras(await api.cameras());
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    loadCameras();
    const t = setInterval(loadCameras, 60_000);
    return () => clearInterval(t);
  }, [loadCameras]);

  useEffect(() => {
    return api.onEvent(() => {
      if (parseHash().tab !== "events") setUnseen((n) => n + 1);
    });
  }, []);

  useEffect(() => {
    if (route.tab === "events") setUnseen(0);
  }, [route.tab]);

  const go = (tab, arg) => {
    window.location.hash = arg ? `#/${tab}/${arg}` : `#/${tab}`;
  };

  const liveCamera = route.tab === "live" ? cameras.find((c) => c.id === decodeURIComponent(route.arg || "")) : null;

  return (
    <div className="flex h-full flex-col">
      <header className="safe-top sticky top-0 z-10 border-b border-ink-700 bg-ink-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <h1 className="text-lg font-semibold tracking-tight">
            <span className="text-accent">●</span> Surveil
          </h1>
          <span className="text-xs text-slate-400">
            {cameras.length} camera{cameras.length === 1 ? "" : "s"}
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-4">
        {error && (
          <div className="mb-4 rounded-lg border border-red-900 bg-red-950/60 px-3 py-2 text-sm text-red-200">
            Can't reach the server: {error}
          </div>
        )}
        {route.tab === "cameras" && <CameraGrid cameras={cameras} onOpen={(c) => go("live", encodeURIComponent(c.id))} />}
        {route.tab === "events" && <EventsList cameras={cameras} selectedId={route.arg} onOpenLive={(id) => go("live", encodeURIComponent(id))} />}
        {route.tab === "recordings" && <RecordingsPage cameras={cameras} />}
        {route.tab === "status" && <StatusPage cameras={cameras} onCameraChange={loadCameras} />}
        {route.tab === "live" && !liveCamera && cameras.length > 0 && (
          <p className="text-sm text-slate-400">Unknown camera.</p>
        )}
      </main>

      {liveCamera && <LiveView camera={liveCamera} onClose={() => go("cameras")} />}

      <nav className="safe-bottom sticky bottom-0 border-t border-ink-700 bg-ink-950/95 backdrop-blur">
        <div className="mx-auto grid max-w-6xl grid-cols-4">
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = route.tab === id || (route.tab === "live" && id === "cameras");
            return (
              <button
                key={id}
                onClick={() => go(id)}
                className={`relative flex flex-col items-center gap-1 py-2.5 text-[11px] ${active ? "text-accent" : "text-slate-400"}`}
              >
                <Icon size={20} strokeWidth={active ? 2.4 : 1.8} />
                {label}
                {id === "events" && unseen > 0 && (
                  <span className="absolute right-[22%] top-1.5 min-w-[18px] rounded-full bg-accent px-1 text-center text-[10px] font-semibold text-ink-950">
                    {unseen > 99 ? "99+" : unseen}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
