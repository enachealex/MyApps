import fs from "node:fs";
import path from "node:path";
import type { AdapterRegistry } from "./adapters/registry.js";
import type { CameraEvent, Snapshot } from "./adapters/types.js";
import type { Alerts } from "./alerts.js";
import type { Db } from "./db.js";
import { logger } from "./log.js";

const log = logger("pipeline");

export interface StoredEvent {
  id: number;
  cameraId: string;
  cameraName: string;
  type: CameraEvent["type"];
  at: number;
  hasSnapshot: boolean;
}

/**
 * Adapter event → grab a snapshot → store → push alert → tell live UI clients.
 * Snapshots go to dataDir/snapshots/YYYY/MM/DD/.
 */
export class EventPipeline {
  private readonly sseClients = new Set<(payload: StoredEvent) => void>();

  constructor(
    private readonly registry: AdapterRegistry,
    private readonly db: Db,
    private readonly alerts: Alerts,
    private readonly dataDir: string,
  ) {
    registry.onEvent((ev) => void this.handle(ev));
  }

  subscribe(cb: (payload: StoredEvent) => void): () => void {
    this.sseClients.add(cb);
    return () => this.sseClients.delete(cb);
  }

  private async handle(ev: CameraEvent): Promise<void> {
    const resolved = this.registry.resolve(ev.cameraId);
    if (!resolved) {
      log.warn("Event for unknown camera", ev.cameraId);
      return;
    }
    let snapshot: Snapshot | undefined;
    let snapshotPath: string | null = null;
    if (resolved.camera.supports.snapshot) {
      try {
        snapshot = await withTimeout(resolved.adapter.getSnapshot(resolved.externalId), 10_000);
        snapshotPath = this.storeSnapshot(ev, snapshot);
      } catch (err) {
        log.warn("Snapshot for event failed", err instanceof Error ? err.message : err);
      }
    }
    const id = this.db.insertEvent(ev, snapshotPath);
    log.info(`Event #${id} ${ev.type} on ${resolved.camera.name}`);
    const stored: StoredEvent = {
      id,
      cameraId: ev.cameraId,
      cameraName: resolved.camera.name,
      type: ev.type,
      at: ev.at,
      hasSnapshot: snapshotPath !== null,
    };
    for (const cb of this.sseClients) cb(stored);
    await this.alerts.notify(ev, id, resolved.camera, snapshot);
  }

  private storeSnapshot(ev: CameraEvent, snap: Snapshot): string {
    const d = new Date(ev.at);
    const dir = path.join(
      this.dataDir,
      "snapshots",
      String(d.getFullYear()),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0"),
    );
    fs.mkdirSync(dir, { recursive: true });
    const ext = snap.contentType.includes("png") ? "png" : snap.contentType.includes("svg") ? "svg" : "jpg";
    const file = path.join(dir, `${ev.at}-${ev.cameraId.replace(/[^a-z0-9]+/gi, "_")}.${ext}`);
    fs.writeFileSync(file, snap.data);
    return path.relative(this.dataDir, file);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }, (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}
