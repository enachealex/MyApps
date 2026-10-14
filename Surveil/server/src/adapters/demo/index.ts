import type { Camera, CameraAdapter, CameraEvent, LiveSource, Snapshot } from "../types.js";
import { cameraId } from "../types.js";

export const ADAPTER_NAME = "demo";

const DEMO_CAMERAS = [
  { id: "front-door", name: "Front door", hue: 210 },
  { id: "driveway", name: "Driveway", hue: 30 },
  { id: "back-yard", name: "Back yard", hue: 130 },
];

/**
 * Fake cameras so the UI, events pipeline and alerts can be developed and
 * demoed without any real camera or Alarm.com credentials. Snapshots are
 * generated SVGs with a clock so refreshes are visible.
 */
export class DemoAdapter implements CameraAdapter {
  readonly name = ADAPTER_NAME;
  private readonly listeners = new Set<(ev: CameraEvent) => void>();
  private timer?: NodeJS.Timeout;
  private eventsEmitted = 0;

  async start(): Promise<void> {
    this.timer = setInterval(() => {
      const cam = DEMO_CAMERAS[Math.floor(Math.random() * DEMO_CAMERAS.length)];
      const ev: CameraEvent = {
        cameraId: cameraId(this.name, cam.id),
        type: Math.random() < 0.3 ? "person" : "motion",
        at: Date.now(),
        raw: { demo: true },
      };
      this.eventsEmitted++;
      for (const cb of this.listeners) cb(ev);
    }, 45_000);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
  }

  async listCameras(): Promise<Camera[]> {
    return DEMO_CAMERAS.map((c) => ({
      id: cameraId(this.name, c.id),
      adapter: this.name,
      externalId: c.id,
      name: c.name,
      model: "Demo",
      online: true,
      supports: { live: false, snapshot: true, recordings: false },
    }));
  }

  async getSnapshot(externalId: string): Promise<Snapshot> {
    const cam = DEMO_CAMERAS.find((c) => c.id === externalId);
    if (!cam) throw new Error(`Unknown demo camera ${externalId}`);
    const t = Date.now();
    const x = 80 + ((t / 50) % 480);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="hsl(${cam.hue},35%,22%)"/><stop offset="1" stop-color="hsl(${cam.hue},30%,10%)"/>
  </linearGradient></defs>
  <rect width="640" height="360" fill="url(#g)"/>
  <rect y="280" width="640" height="80" fill="hsl(${cam.hue},20%,8%)"/>
  <circle cx="${x.toFixed(0)}" cy="250" r="22" fill="hsl(${cam.hue},80%,65%)" opacity="0.9"/>
  <text x="16" y="34" font-family="ui-monospace,monospace" font-size="20" fill="#e5e7eb">${cam.name.toUpperCase()}</text>
  <text x="16" y="344" font-family="ui-monospace,monospace" font-size="16" fill="#d1d5db">${new Date(t).toISOString().replace("T", " ").slice(0, 19)} UTC</text>
</svg>`;
    return { data: Buffer.from(svg, "utf8"), contentType: "image/svg+xml" };
  }

  async getLiveSource(): Promise<LiveSource> {
    return { kind: "none", reason: "Demo cameras only have snapshots" };
  }

  onEvent(cb: (ev: CameraEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  status(): Record<string, unknown> {
    return { cameras: DEMO_CAMERAS.length, eventsEmitted: this.eventsEmitted };
  }
}
