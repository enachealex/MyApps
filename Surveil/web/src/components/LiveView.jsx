import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api } from "../api.js";
import WebRtcPlayer from "../players/WebRtcPlayer.jsx";

/**
 * Full-screen live view. Asks the server for a live source and picks a
 * player for it. Cameras without live support fall back to a fast snapshot
 * refresh so there is always something on screen.
 */
export default function LiveView({ camera, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-black">
      <div className="safe-top flex items-center justify-between px-4 py-3">
        <div>
          <div className="text-sm font-semibold">{camera.name}</div>
          <div className="text-[11px] text-slate-400">{camera.model || camera.adapter}</div>
        </div>
        <button onClick={onClose} aria-label="Close" className="rounded-full bg-ink-800 p-2 text-slate-200 hover:bg-ink-700">
          <X size={18} />
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center">
        {camera.supports.live ? <LiveStream camera={camera} /> : <SnapshotLoop camera={camera} />}
      </div>
    </div>
  );
}

function LiveStream({ camera }) {
  const [source, setSource] = useState(null);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setSource(null);
    setError(null);
    api
      .liveSource(camera.id)
      .then((s) => !cancelled && setSource(s))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [camera.id, nonce]);

  if (error) {
    return (
      <Message>
        Couldn't start live video: {error}
        <button onClick={() => setNonce((n) => n + 1)} className="ml-3 rounded bg-ink-700 px-2 py-1 text-xs">
          Retry
        </button>
      </Message>
    );
  }
  if (!source) return <Message>Connecting…</Message>;
  if (source.kind === "janus" || source.kind === "webrtc-signalling") {
    return <WebRtcPlayer source={source} onExpired={() => setNonce((n) => n + 1)} />;
  }
  if (source.kind === "hls") return <Message>HLS playback arrives with the RTSP adapter.</Message>;
  return <SnapshotLoop camera={camera} note={source.reason} />;
}

function SnapshotLoop({ camera, note }) {
  const [src, setSrc] = useState(() => api.snapshotUrl(camera.id));
  useEffect(() => {
    const t = setInterval(() => setSrc(api.snapshotUrl(camera.id)), 2_000);
    return () => clearInterval(t);
  }, [camera.id]);
  return (
    <div className="relative h-full w-full">
      <img src={src} alt={camera.name} className="h-full w-full object-contain" />
      <div className="absolute bottom-3 left-3 rounded bg-black/60 px-2 py-1 text-[11px] text-slate-300">
        {note || "Snapshot every 2 s"}
      </div>
    </div>
  );
}

function Message({ children }) {
  return <div className="px-6 text-center text-sm text-slate-400">{children}</div>;
}
