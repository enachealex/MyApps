import type { Camera, CameraEvent } from "./adapters/types.js";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { logger } from "./log.js";

const log = logger("alerts");

const TITLES: Record<CameraEvent["type"], string> = {
  motion: "Motion",
  person: "Person detected",
  package: "Package",
  analytics: "Activity",
  triggered: "Camera triggered",
  unknown: "Event",
};

/**
 * Pushes events to a phone through ntfy (https://ntfy.sh, or self-hosted).
 * A snapshot is attached when we have one, and the Click header deep-links
 * back into the app. Per-camera on/off and quiet hours live in the DB.
 */
export class Alerts {
  private lastSent = new Map<string, number>();

  constructor(
    private readonly cfg: Config,
    private readonly db: Db,
    private readonly publicUrl: string,
  ) {}

  get enabled(): boolean {
    return Boolean(this.cfg.alerts.ntfy);
  }

  async notify(ev: CameraEvent, eventId: number, camera: Camera, snapshot?: { data: Buffer; contentType: string }): Promise<void> {
    if (!this.enabled) return;
    const prefs = this.db.cameraPrefs(camera.id);
    if (!prefs.alertsEnabled) return;
    if (inQuietHours(prefs.quietFrom, prefs.quietTo, new Date(ev.at))) return;
    const last = this.lastSent.get(camera.id) ?? 0;
    if (ev.at - last < this.cfg.alerts.cooldownSec * 1000) return;
    this.lastSent.set(camera.id, ev.at);

    const title = `${TITLES[ev.type]} · ${camera.name}`;
    const message = new Date(ev.at).toLocaleTimeString();
    const click = `${this.publicUrl}/#/events/${eventId}`;
    const headers: Record<string, string> = {
      Title: title,
      Click: click,
      Tags: ev.type === "person" ? "bust_in_silhouette" : "movie_camera",
      Priority: ev.type === "person" ? "high" : "default",
    };
    try {
      let res: Response;
      if (snapshot) {
        const ext = snapshot.contentType.includes("png") ? "png" : snapshot.contentType.includes("svg") ? "svg" : "jpg";
        res = await fetch(this.cfg.alerts.ntfy!, {
          method: "PUT",
          headers: { ...headers, Message: message, Filename: `${camera.externalId}-${ev.at}.${ext}`, "Content-Type": snapshot.contentType },
          body: new Uint8Array(snapshot.data),
          signal: AbortSignal.timeout(15_000),
        });
      } else {
        res = await fetch(this.cfg.alerts.ntfy!, {
          method: "POST",
          headers,
          body: message,
          signal: AbortSignal.timeout(15_000),
        });
      }
      if (!res.ok) throw new Error(`ntfy responded ${res.status}`);
      this.db.markNotified(eventId);
    } catch (err) {
      log.warn("ntfy push failed", err instanceof Error ? err.message : err);
    }
  }
}

/** quietFrom/quietTo are "HH:MM" local time; the range may cross midnight. */
export function inQuietHours(from: string | null, to: string | null, now: Date): boolean {
  if (!from || !to) return false;
  const mins = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    return h * 60 + (m || 0);
  };
  const cur = now.getHours() * 60 + now.getMinutes();
  const a = mins(from);
  const b = mins(to);
  return a <= b ? cur >= a && cur < b : cur >= a || cur < b;
}
