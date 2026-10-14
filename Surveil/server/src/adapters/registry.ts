import type { Config } from "../config.js";
import { logger } from "../log.js";
import { AlarmComAdapter } from "./alarmcom/index.js";
import { DemoAdapter } from "./demo/index.js";
import type { Camera, CameraAdapter, CameraEvent } from "./types.js";
import { splitCameraId } from "./types.js";

const log = logger("registry");

/**
 * Owns every enabled adapter, keeps a merged camera list fresh, and fans
 * adapter events out to one callback.
 */
export class AdapterRegistry {
  private readonly adapters = new Map<string, CameraAdapter>();
  private readonly startErrors = new Map<string, string>();
  private cameras: Camera[] = [];
  private refreshTimer?: NodeJS.Timeout;
  private eventListeners = new Set<(ev: CameraEvent) => void>();

  constructor(private readonly cfg: Config) {
    if (cfg.adapters.demo?.enabled) this.adapters.set("demo", new DemoAdapter());
    if (cfg.adapters.alarmcom?.enabled) {
      this.adapters.set("alarmcom", new AlarmComAdapter(cfg.adapters.alarmcom, cfg.dataDir));
    }
  }

  async start(): Promise<void> {
    for (const [name, adapter] of this.adapters) {
      try {
        await adapter.start();
        adapter.onEvent((ev) => this.emit(ev));
        log.info(`Adapter started: ${name}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.startErrors.set(name, msg);
        log.error(`Adapter failed to start: ${name}`, msg);
      }
    }
    await this.refreshCameras();
    this.refreshTimer = setInterval(() => void this.refreshCameras(), this.cfg.cameraRefreshSec * 1000);
  }

  async stop(): Promise<void> {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    for (const adapter of this.adapters.values()) await adapter.stop().catch(() => undefined);
  }

  onEvent(cb: (ev: CameraEvent) => void): () => void {
    this.eventListeners.add(cb);
    return () => this.eventListeners.delete(cb);
  }

  private emit(ev: CameraEvent): void {
    for (const cb of this.eventListeners) cb(ev);
  }

  async refreshCameras(): Promise<Camera[]> {
    const merged: Camera[] = [];
    for (const [name, adapter] of this.adapters) {
      if (this.startErrors.has(name)) continue;
      try {
        merged.push(...(await adapter.listCameras()));
      } catch (err) {
        log.warn(`Camera list failed for ${name}`, err instanceof Error ? err.message : err);
        // Keep the last known cameras for this adapter rather than dropping them.
        merged.push(...this.cameras.filter((c) => c.adapter === name));
      }
    }
    this.cameras = merged;
    return merged;
  }

  listCameras(): Camera[] {
    return this.cameras;
  }

  getCamera(id: string): Camera | undefined {
    return this.cameras.find((c) => c.id === id);
  }

  resolve(id: string): { adapter: CameraAdapter; externalId: string; camera: Camera } | undefined {
    const parts = splitCameraId(id);
    if (!parts) return undefined;
    const adapter = this.adapters.get(parts.adapter);
    const camera = this.getCamera(id);
    if (!adapter || !camera) return undefined;
    return { adapter, externalId: parts.externalId, camera };
  }

  status(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [name, adapter] of this.adapters) {
      out[name] = { ...adapter.status(), startError: this.startErrors.get(name) ?? null };
    }
    return out;
  }
}
