import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Camera, CameraEvent } from "./adapters/types.js";

export interface EventRow {
  id: number;
  camera_id: string;
  type: string;
  at: number;
  snapshot_path: string | null;
  notified_at: number | null;
}

/**
 * SQLite via node:sqlite, so there is no native build step. One file in
 * dataDir. The schema is created on open; later changes are additive.
 */
export class Db {
  private db: DatabaseSync;

  constructor(dataDir: string) {
    this.db = new DatabaseSync(path.join(dataDir, "surveil.sqlite"));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS cameras (
        id TEXT PRIMARY KEY,
        adapter TEXT NOT NULL,
        external_id TEXT NOT NULL,
        name TEXT NOT NULL,
        model TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        alerts_enabled INTEGER NOT NULL DEFAULT 1,
        quiet_from TEXT,
        quiet_to TEXT,
        last_seen INTEGER
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        camera_id TEXT NOT NULL,
        type TEXT NOT NULL,
        at INTEGER NOT NULL,
        snapshot_path TEXT,
        notified_at INTEGER,
        raw TEXT
      );
      CREATE INDEX IF NOT EXISTS events_camera_at ON events(camera_id, at DESC);
      CREATE TABLE IF NOT EXISTS clips (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        camera_id TEXT NOT NULL,
        external_id TEXT,
        start_ts INTEGER NOT NULL,
        end_ts INTEGER,
        url TEXT,
        local_path TEXT,
        UNIQUE(camera_id, external_id)
      );
      CREATE TABLE IF NOT EXISTS segments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        camera_id TEXT NOT NULL,
        start_ts INTEGER NOT NULL,
        end_ts INTEGER NOT NULL,
        path TEXT NOT NULL,
        bytes INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
  }

  upsertCamera(cam: Camera): void {
    this.db
      .prepare(
        `INSERT INTO cameras (id, adapter, external_id, name, model, last_seen)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, model = excluded.model, last_seen = excluded.last_seen`,
      )
      .run(cam.id, cam.adapter, cam.externalId, cam.name, cam.model ?? null, Date.now());
  }

  cameraPrefs(id: string): { alertsEnabled: boolean; quietFrom: string | null; quietTo: string | null } {
    const row = this.db
      .prepare("SELECT alerts_enabled, quiet_from, quiet_to FROM cameras WHERE id = ?")
      .get(id) as { alerts_enabled: number; quiet_from: string | null; quiet_to: string | null } | undefined;
    return {
      alertsEnabled: row ? row.alerts_enabled === 1 : true,
      quietFrom: row?.quiet_from ?? null,
      quietTo: row?.quiet_to ?? null,
    };
  }

  setCameraPrefs(
    id: string,
    prefs: { alertsEnabled?: boolean; quietFrom?: string | null; quietTo?: string | null },
  ): void {
    if (prefs.alertsEnabled !== undefined) {
      this.db.prepare("UPDATE cameras SET alerts_enabled = ? WHERE id = ?").run(prefs.alertsEnabled ? 1 : 0, id);
    }
    if (prefs.quietFrom !== undefined) {
      this.db.prepare("UPDATE cameras SET quiet_from = ? WHERE id = ?").run(prefs.quietFrom, id);
    }
    if (prefs.quietTo !== undefined) {
      this.db.prepare("UPDATE cameras SET quiet_to = ? WHERE id = ?").run(prefs.quietTo, id);
    }
  }

  insertEvent(ev: CameraEvent, snapshotPath: string | null): number {
    const res = this.db
      .prepare("INSERT INTO events (camera_id, type, at, snapshot_path, raw) VALUES (?, ?, ?, ?, ?)")
      .run(ev.cameraId, ev.type, ev.at, snapshotPath, ev.raw === undefined ? null : JSON.stringify(ev.raw));
    return Number(res.lastInsertRowid);
  }

  markNotified(eventId: number): void {
    this.db.prepare("UPDATE events SET notified_at = ? WHERE id = ?").run(Date.now(), eventId);
  }

  listEvents(opts: { cameraId?: string; from?: number; to?: number; limit?: number }): EventRow[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (opts.cameraId) {
      where.push("camera_id = ?");
      args.push(opts.cameraId);
    }
    if (opts.from) {
      where.push("at >= ?");
      args.push(opts.from);
    }
    if (opts.to) {
      where.push("at <= ?");
      args.push(opts.to);
    }
    const sql = `SELECT id, camera_id, type, at, snapshot_path, notified_at FROM events
                 ${where.length ? "WHERE " + where.join(" AND ") : ""}
                 ORDER BY at DESC LIMIT ?`;
    args.push(Math.min(opts.limit ?? 100, 500));
    return this.db.prepare(sql).all(...args) as unknown as EventRow[];
  }

  getEvent(id: number): EventRow | undefined {
    return this.db
      .prepare("SELECT id, camera_id, type, at, snapshot_path, notified_at FROM events WHERE id = ?")
      .get(id) as EventRow | undefined;
  }

  getSetting(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }

  close(): void {
    this.db.close();
  }
}
