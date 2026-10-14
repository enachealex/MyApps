/**
 * Every camera source (Alarm.com cloud, RTSP/ONVIF on the LAN, the demo
 * adapter) implements CameraAdapter. The API and UI only ever see these
 * types, so a Reolink and an Alarm.com doorbell sit in the same grid.
 */

export interface Camera {
  /** Globally unique: `${adapter}:${externalId}` */
  id: string;
  adapter: string;
  externalId: string;
  name: string;
  model?: string;
  online: boolean;
  /** Free-form health note ("malfunctioning", "low battery") for the UI badge. */
  health?: string;
  privateIp?: string;
  supports: { live: boolean; snapshot: boolean; recordings: boolean };
}

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export type LiveSource =
  | {
      /** Alarm.com proxy path: browser talks to a Janus gateway over WebSocket. */
      kind: "janus";
      gatewayUrl: string;
      token: string;
      /** Static mountpoint id, or null when a proxy mountpoint must be created first. */
      streamId: number | null;
      /** media_uri Janus pulls from when a mountpoint must be created. */
      proxyUrl?: string;
      iceServers: IceServer[];
      /** Epoch ms after which the client should ask for a fresh source. */
      expiresAt: number;
    }
  | {
      /** Alarm.com end-to-end path: custom signalling server, camera answers directly. */
      kind: "webrtc-signalling";
      signallingServerUrl: string;
      signallingServerToken: string;
      cameraAuthToken: string;
      iceServers: IceServer[];
      expiresAt: number;
    }
  | { kind: "hls"; url: string }
  | { kind: "none"; reason: string };

export type CameraEventType = "motion" | "person" | "package" | "analytics" | "triggered" | "unknown";

export interface CameraEvent {
  cameraId: string;
  type: CameraEventType;
  /** Epoch ms */
  at: number;
  raw?: unknown;
}

export interface Snapshot {
  data: Buffer;
  contentType: string;
}

export interface CameraAdapter {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  listCameras(): Promise<Camera[]>;
  getSnapshot(externalId: string): Promise<Snapshot>;
  getLiveSource(externalId: string): Promise<LiveSource>;
  /** Subscribe to motion/person/etc. events. Returns an unsubscribe function. */
  onEvent(cb: (ev: CameraEvent) => void): () => void;
  /** Diagnostic blob for the Status page. Never include secrets. */
  status(): Record<string, unknown>;
}

export function cameraId(adapter: string, externalId: string): string {
  return `${adapter}:${externalId}`;
}

export function splitCameraId(id: string): { adapter: string; externalId: string } | null {
  const i = id.indexOf(":");
  if (i < 1) return null;
  return { adapter: id.slice(0, i), externalId: id.slice(i + 1) };
}
