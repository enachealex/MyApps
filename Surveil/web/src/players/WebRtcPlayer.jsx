import { useEffect, useRef, useState } from "react";

/**
 * Plays an Alarm.com live stream in the browser. Two transports:
 *
 *  - "janus": open a WebSocket to Alarm.com's Janus gateway, attach the
 *    streaming plugin, (optionally create a proxy mountpoint), watch it,
 *    answer the SDP offer, trickle ICE. Keepalive every 25 s.
 *  - "webrtc-signalling": a small text protocol on a signalling server
 *    (HELLO / START_SESSION) that relays SDP and ICE to the camera itself.
 *
 * Both were derived from the alarm-webrtc-card in ibasebcast/ha-alarmdotcom.
 * The player restarts itself on hangups; when the source is past its
 * expiry it asks the parent for a fresh one instead.
 */
export default function WebRtcPlayer({ source, onExpired }) {
  const videoRef = useRef(null);
  const [state, setState] = useState("connecting");
  const [detail, setDetail] = useState("");

  useEffect(() => {
    let disposed = false;
    let pc = null;
    let ws = null;
    let keepalive = null;
    let retryTimer = null;
    let attempts = 0;

    const log = (...args) => {
      if (window.SURVEIL_DEBUG) console.log("[webrtc]", ...args);
    };

    const teardown = () => {
      if (keepalive) clearInterval(keepalive);
      keepalive = null;
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      ws = null;
      try {
        pc?.close();
      } catch {
        /* ignore */
      }
      pc = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    const fail = (reason) => {
      if (disposed) return;
      log("fail", reason);
      teardown();
      if (Date.now() > source.expiresAt) {
        onExpired?.();
        return;
      }
      attempts += 1;
      if (attempts > 4) {
        setState("error");
        setDetail(reason);
        return;
      }
      setState("connecting");
      setDetail(`Reconnecting (${reason})`);
      retryTimer = setTimeout(start, Math.min(1000 * 2 ** attempts, 10_000));
    };

    const makePeer = () => {
      const peer = new RTCPeerConnection({ iceServers: source.iceServers || [] });
      peer.ontrack = (e) => {
        const v = videoRef.current;
        if (v && !v.srcObject) {
          v.srcObject = e.streams[0];
          v.muted = true;
          v.play().catch(() => undefined);
          setState("playing");
          setDetail("");
        }
      };
      peer.oniceconnectionstatechange = () => {
        const s = peer.iceConnectionState;
        log("ice", s);
        if (s === "failed" || s === "closed") fail(`ICE ${s}`);
        if (s === "disconnected") setDetail("Connection unstable");
        if (s === "connected" || s === "completed") setDetail("");
      };
      return peer;
    };

    const startJanus = () => {
      pc = makePeer();
      ws = new WebSocket(source.gatewayUrl, ["janus-protocol"]);
      let sessionId = null;
      let handleId = null;
      let streamId = source.streamId;
      const needsCreate = Boolean(source.proxyUrl);
      let mountpointCreated = false;

      const send = (msg) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ ...msg, token: source.token, transaction: Math.random().toString(36).slice(2) }));
      };

      ws.onopen = () => send({ janus: "create" });
      ws.onerror = () => fail("Janus socket error");
      ws.onclose = () => {
        if (!disposed && state !== "error") fail("Janus socket closed");
      };
      ws.onmessage = async (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        log("janus", msg.janus, msg);

        if (msg.janus === "success" && !sessionId) {
          sessionId = msg.data?.id;
          keepalive = setInterval(() => send({ janus: "keepalive", session_id: sessionId }), 25_000);
          send({ janus: "attach", session_id: sessionId, plugin: "janus.plugin.streaming" });
          return;
        }
        if (msg.janus === "success" && sessionId && !handleId) {
          handleId = msg.data?.id;
          if (needsCreate) {
            send({
              janus: "message",
              session_id: sessionId,
              handle_id: handleId,
              body: {
                request: "create",
                type: "rtp",
                media_uri: source.proxyUrl,
                name: `${source.token.split(",")[0] || "stream"}_Live`,
                is_private: true,
                streaming_type: "Live",
                video: true,
                videoport: 0,
                videopt: 126,
                videortpmap: "H264/90000",
                timeout_seconds: 180,
                max_timeout_seconds: 900,
              },
            });
          } else {
            send({
              janus: "message",
              session_id: sessionId,
              handle_id: handleId,
              body: { request: "watch", id: streamId, token: source.token, audio: true, video: true },
            });
          }
          return;
        }
        if (msg.janus === "success" && handleId && needsCreate && !mountpointCreated) {
          const createdId = msg.plugindata?.data?.stream?.id ?? msg.data?.id ?? msg.plugindata?.data?.id;
          if (createdId) {
            mountpointCreated = true;
            streamId = createdId;
            send({
              janus: "message",
              session_id: sessionId,
              handle_id: handleId,
              body: { request: "watch", id: streamId, token: source.token, audio: true, video: true },
            });
            return;
          }
        }
        if (msg.janus === "event" && msg.plugindata?.data?.error) {
          fail(`Janus plugin error ${msg.plugindata.data.error_code}`);
          return;
        }
        if (msg.jsep) {
          let remote = msg.jsep;
          if (isApple() && remote.sdp) remote = { type: remote.type, sdp: patchAppleSdp(remote.sdp) };
          await pc.setRemoteDescription(remote);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          send({ janus: "message", session_id: sessionId, handle_id: handleId, body: { request: "start" }, jsep: pc.localDescription });
          return;
        }
        if (msg.candidate) {
          pc.addIceCandidate(msg.candidate).catch(() => undefined);
          return;
        }
        if (msg.janus === "hangup" || msg.janus === "detached" || msg.janus === "error") {
          fail(`Janus ${msg.janus}`);
        }
      };

      pc.onicecandidate = (e) => {
        if (e.candidate && sessionId && handleId) {
          send({ janus: "trickle", session_id: sessionId, handle_id: handleId, candidate: e.candidate });
        }
      };
    };

    const startSignalling = () => {
      pc = makePeer();
      ws = new WebSocket(`${source.signallingServerUrl}/${source.signallingServerToken}`);
      ws.onopen = () => ws.send("HELLO 2.0.1");
      ws.onerror = () => fail("Signalling socket error");
      ws.onclose = () => {
        if (!disposed && state !== "error") fail("Signalling socket closed");
      };
      ws.onmessage = async (msg) => {
        const text = String(msg.data);
        if (text.startsWith("HELLO")) {
          ws.send(`START_SESSION ${source.cameraAuthToken}`);
          return;
        }
        if (text.startsWith("SESSION_STARTED")) return;
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          return;
        }
        if (data.sdp?.type === "offer") {
          let offer = data.sdp;
          if (isApple() && offer.sdp) offer = { type: offer.type, sdp: patchAppleSdp(offer.sdp) };
          await pc.setRemoteDescription(offer);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await waitForIceGathering(pc, 5000);
          ws.send(JSON.stringify({ to: data.from, sdp: pc.localDescription }));
        }
        if (data.ice) pc.addIceCandidate(data.ice).catch(() => undefined);
      };
    };

    const start = () => {
      if (disposed) return;
      teardown();
      try {
        if (source.kind === "janus") startJanus();
        else startSignalling();
      } catch (err) {
        fail(err.message || "start failed");
      }
    };

    start();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  return (
    <div className="relative h-full w-full">
      <video ref={videoRef} playsInline autoPlay muted className="h-full w-full object-contain" />
      {state !== "playing" && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">
          {state === "error" ? `Live video failed: ${detail}` : detail || "Connecting…"}
        </div>
      )}
      {state === "playing" && detail && (
        <div className="absolute bottom-3 left-3 rounded bg-black/60 px-2 py-1 text-[11px] text-amber-300">{detail}</div>
      )}
    </div>
  );
}

function isApple() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod|Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|CriOS|FxiOS/.test(ua);
}

/** Safari refuses profiles it doesn't list; baseline 4.2 always negotiates. */
function patchAppleSdp(sdp) {
  return sdp.replace(/profile-level-id=[0-9a-fA-F]{6}/g, "profile-level-id=42e01f");
}

function waitForIceGathering(pc, timeoutMs) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    const done = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", done);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", done);
    setTimeout(resolve, timeoutMs);
  });
}
