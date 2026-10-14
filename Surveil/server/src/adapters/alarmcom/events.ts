import { logger } from "../../log.js";
import type { CameraEvent, CameraEventType } from "../types.js";
import type { AdcClient } from "./client.js";

const log = logger("adc:events");

/**
 * Alarm.com event codes seen on the websocket feed. Which ones your cameras
 * emit depends on the video plan; unknown video-ish codes still surface as
 * "unknown" so nothing is silently dropped.
 */
const EVENT_TYPES: Record<number, CameraEventType> = {
  302: "motion", // VideoAnalytics2Detection
  71: "triggered", // VideoCameraTriggered (person / package)
  76: "triggered", // VideoEventTriggered
  210: "analytics", // VideoAnalyticsDetection
  363: "package", // PackageDeliveryAlert
  364: "package", // PackageRetrievalAlert
};

export interface RawWsMessage {
  eventType?: number;
  event_type?: number;
  eventValue?: unknown;
  eventDateUtc?: string;
  event_date_utc?: string;
  qstringForExtraData?: string;
  unitId?: string | number;
  unit_id?: string | number;
  deviceId?: string | number;
  device_id?: string | number;
  [k: string]: unknown;
}

/**
 * Keeps one websocket open to Alarm.com's push feed and turns video events
 * into CameraEvents. Reconnects with backoff and re-fetches the token each
 * time, because the token is single-use.
 */
export class AdcEventFeed {
  private ws?: WebSocket;
  private stopped = false;
  private backoffMs = 5_000;
  private reconnectTimer?: NodeJS.Timeout;
  lastMessageAt?: number;
  lastEventAt?: number;
  state: "idle" | "connecting" | "open" | "closed" = "idle";

  constructor(
    private readonly client: AdcClient,
    private readonly makeCameraId: (externalId: string) => string,
    private readonly onEvent: (ev: CameraEvent) => void,
    private readonly knownCamera: (externalId: string) => boolean,
  ) {}

  start(): void {
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = undefined;
    this.state = "closed";
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.state = "connecting";
    let endpoint: string;
    let token: string;
    try {
      ({ endpoint, token } = await this.client.getWebSocketToken());
    } catch (err) {
      log.warn("Could not get websocket token", err);
      this.scheduleReconnect();
      return;
    }

    const url = `${endpoint.replace(/\/$/, "")}/?f=1&auth=${encodeURIComponent(token)}`;
    log.info("Connecting to event feed", { host: new URL(endpoint).host });
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.state = "open";
      this.backoffMs = 5_000;
      log.info("Event feed connected");
    };
    ws.onmessage = (msg) => {
      this.lastMessageAt = Date.now();
      let parsed: RawWsMessage;
      try {
        parsed = JSON.parse(String(msg.data));
      } catch {
        return;
      }
      this.handle(parsed);
    };
    ws.onerror = (ev) => log.warn("Event feed error", (ev as ErrorEvent).message ?? ev.type);
    ws.onclose = (ev) => {
      log.info("Event feed closed", { code: ev.code, reason: ev.reason });
      this.state = "closed";
      if (this.ws === ws) this.ws = undefined;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 120_000);
    this.reconnectTimer = setTimeout(() => void this.connect(), delay);
  }

  private handle(m: RawWsMessage): void {
    const code = num(m.eventType ?? m.event_type);
    const unitId = m.unitId ?? m.unit_id;
    const deviceId = m.deviceId ?? m.device_id;
    if (code === undefined || unitId === undefined || deviceId === undefined) {
      log.debug("Ignoring non-event message", Object.keys(m));
      return;
    }
    const externalId = `${unitId}-${deviceId}`;
    const type = EVENT_TYPES[code];
    if (!type) {
      if (this.knownCamera(externalId)) log.debug("Unmapped event code for a camera", { code, externalId });
      return;
    }
    if (!this.knownCamera(externalId)) {
      log.debug("Video event for unknown device", { code, externalId });
      return;
    }
    const when = m.eventDateUtc ?? m.event_date_utc;
    const at = when ? Date.parse(when) || Date.now() : Date.now();
    this.lastEventAt = at;
    this.onEvent({ cameraId: this.makeCameraId(externalId), type, at, raw: { code, extra: m.qstringForExtraData ?? null } });
  }
}

function num(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  return undefined;
}
