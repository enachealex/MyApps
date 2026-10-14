import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { AdapterRegistry } from "./adapters/registry.js";
import { Alerts } from "./alerts.js";
import { loadConfig } from "./config.js";
import { Db } from "./db.js";
import { logger } from "./log.js";
import { EventPipeline } from "./pipeline.js";
import { registerApi } from "./routes/api.js";

const log = logger("server");

async function main(): Promise<void> {
  const cfg = loadConfig();
  const startedAt = Date.now();
  log.info("Config loaded", { configPath: cfg.configPath, dataDir: cfg.dataDir, port: cfg.port });

  const db = new Db(cfg.dataDir);
  const registry = new AdapterRegistry(cfg);
  const publicUrl = process.env.PUBLIC_URL ?? `http://localhost:${cfg.port}`;
  const alerts = new Alerts(cfg, db, publicUrl);
  const pipeline = new EventPipeline(registry, db, alerts, cfg.dataDir);

  await registry.start();
  for (const cam of registry.listCameras()) db.upsertCamera(cam);
  log.info(`Cameras: ${registry.listCameras().map((c) => `${c.name} (${c.id})`).join(", ") || "none"}`);

  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  registerApi(app, { registry, db, pipeline, dataDir: cfg.dataDir, startedAt, alertsEnabled: alerts.enabled });

  // In production the built web app is served from the same origin.
  const webDist = path.resolve(cfg.serverRoot, "..", "web", "dist");
  if (fs.existsSync(path.join(webDist, "index.html"))) {
    await app.register(fastifyStatic, { root: webDist, prefix: "/" });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "Not found" });
      return reply.sendFile("index.html");
    });
    log.info("Serving web UI from web/dist");
  } else {
    log.info("web/dist not found; run the Vite dev server (npm run dev in web/) or build it");
  }

  await app.listen({ port: cfg.port, host: "0.0.0.0" });
  log.info(`Listening on http://0.0.0.0:${cfg.port}`);

  const shutdown = async () => {
    log.info("Shutting down");
    await registry.stop();
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  log.error("Fatal", err);
  process.exit(1);
});
