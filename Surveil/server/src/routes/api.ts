import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { AdapterRegistry } from "../adapters/registry.js";
import type { Db } from "../db.js";
import type { EventPipeline, StoredEvent } from "../pipeline.js";

interface Deps {
  registry: AdapterRegistry;
  db: Db;
  pipeline: EventPipeline;
  dataDir: string;
  startedAt: number;
  alertsEnabled: boolean;
}

const MIME: Record<string, string> = { jpg: "image/jpeg", png: "image/png", svg: "image/svg+xml" };

export function registerApi(app: FastifyInstance, deps: Deps): void {
  const { registry, db, pipeline } = deps;

  app.get("/api/cameras", async () => {
    return registry.listCameras().map((c) => ({ ...c, prefs: db.cameraPrefs(c.id) }));
  });

  app.patch<{ Params: { id: string }; Body: { alertsEnabled?: boolean; quietFrom?: string | null; quietTo?: string | null } }>(
    "/api/cameras/:id",
    async (req, reply) => {
      const cam = registry.getCamera(req.params.id);
      if (!cam) return reply.code(404).send({ error: "Unknown camera" });
      db.upsertCamera(cam);
      db.setCameraPrefs(cam.id, req.body ?? {});
      return { ...cam, prefs: db.cameraPrefs(cam.id) };
    },
  );

  app.get<{ Params: { id: string } }>("/api/cameras/:id/snapshot", async (req, reply) => {
    const r = registry.resolve(req.params.id);
    if (!r) return reply.code(404).send({ error: "Unknown camera" });
    if (!r.camera.supports.snapshot) return reply.code(404).send({ error: "Camera has no snapshot support" });
    try {
      const snap = await r.adapter.getSnapshot(r.externalId);
      reply.header("Cache-Control", "no-store").type(snap.contentType);
      return reply.send(snap.data);
    } catch (err) {
      req.log.warn({ err }, "snapshot failed");
      return reply.code(502).send({ error: err instanceof Error ? err.message : "Snapshot failed" });
    }
  });

  app.get<{ Params: { id: string } }>("/api/cameras/:id/live", async (req, reply) => {
    const r = registry.resolve(req.params.id);
    if (!r) return reply.code(404).send({ error: "Unknown camera" });
    try {
      reply.header("Cache-Control", "no-store");
      return await r.adapter.getLiveSource(r.externalId);
    } catch (err) {
      req.log.warn({ err }, "live source failed");
      return reply.code(502).send({ error: err instanceof Error ? err.message : "Live source failed" });
    }
  });

  app.get<{ Querystring: { camera?: string; from?: string; to?: string; limit?: string } }>("/api/events", async (req) => {
    const rows = db.listEvents({
      cameraId: req.query.camera,
      from: req.query.from ? Number(req.query.from) : undefined,
      to: req.query.to ? Number(req.query.to) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    return rows.map((r) => ({
      id: r.id,
      cameraId: r.camera_id,
      cameraName: registry.getCamera(r.camera_id)?.name ?? r.camera_id,
      type: r.type,
      at: r.at,
      hasSnapshot: Boolean(r.snapshot_path),
      notifiedAt: r.notified_at,
    }));
  });

  app.get<{ Params: { id: string } }>("/api/events/:id/snapshot", async (req, reply) => {
    const row = db.getEvent(Number(req.params.id));
    if (!row?.snapshot_path) return reply.code(404).send({ error: "No snapshot" });
    const file = path.join(deps.dataDir, row.snapshot_path);
    if (!fs.existsSync(file)) return reply.code(404).send({ error: "Snapshot file missing" });
    const ext = path.extname(file).slice(1);
    reply.header("Cache-Control", "private, max-age=86400").type(MIME[ext] ?? "application/octet-stream");
    return reply.send(fs.createReadStream(file));
  });

  /** Server-sent events so the UI can show new events without polling. */
  app.get("/api/events/stream", (req, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(": connected\n\n");
    const send = (ev: StoredEvent) => reply.raw.write(`event: camera-event\ndata: ${JSON.stringify(ev)}\n\n`);
    const unsubscribe = pipeline.subscribe(send);
    const ping = setInterval(() => reply.raw.write(": ping\n\n"), 25_000);
    req.raw.on("close", () => {
      clearInterval(ping);
      unsubscribe();
    });
  });

  app.get("/api/recordings", async () => {
    // Phase 3 (Alarm.com clips) and Phase 4 (local segments) fill this in.
    return { recordings: [], note: "Recordings arrive in Phase 3" };
  });

  app.get("/api/status", async () => ({
    uptimeSec: Math.round((Date.now() - deps.startedAt) / 1000),
    cameras: registry.listCameras().length,
    alertsEnabled: deps.alertsEnabled,
    adapters: registry.status(),
    node: process.version,
  }));
}
