import path from "node:path";
import type { AlarmComConfig } from "../../config.js";
import { logger } from "../../log.js";
import type { Camera, CameraAdapter, CameraEvent, LiveSource, Snapshot } from "../types.js";
import { cameraId } from "../types.js";
import { AdcAuth } from "./auth.js";
import { AdcClient, type AdcCamera } from "./client.js";
import { AdcEventFeed } from "./events.js";
import { AdcAuthError, AdcHttp } from "./http.js";

const log = logger("adc");

export const ADAPTER_NAME = "alarmcom";

export function sessionFilePath(dataDir: string): string {
  return path.join(dataDir, "alarmcom-session.json");
}

export class AlarmComAdapter implements CameraAdapter {
  readonly name = ADAPTER_NAME;
  private readonly http: AdcHttp;
  private readonly auth: AdcAuth;
  private readonly client: AdcClient;
  private readonly feed: AdcEventFeed;
  private readonly listeners = new Set<(ev: CameraEvent) => void>();
  private cameras = new Map<string, AdcCamera>();
  private keepAliveTimer?: NodeJS.Timeout;
  private loggedIn = false;
  private lastError?: string;
  private reloginInFlight?: Promise<void>;

  constructor(cfg: AlarmComConfig, dataDir: string) {
    this.http = new AdcHttp(sessionFilePath(dataDir));
    this.auth = new AdcAuth(this.http, cfg.username, cfg.password, cfg.deviceName ?? "Surveil");
    this.client = new AdcClient(this.http);
    this.feed = new AdcEventFeed(
      this.client,
      (ext) => cameraId(this.name, ext),
      (ev) => this.emit(ev),
      (ext) => this.cameras.has(ext),
    );
  }

  async start(): Promise<void> {
    this.http.load();
    await this.ensureLoggedIn();
    await this.refreshCameras();
    this.feed.start();
    const every = Math.min(Math.max((this.http.keepAliveMs ?? 300_000) / 2, 60_000), 300_000);
    this.keepAliveTimer = setInterval(() => void this.keepAlive(), every);
  }

  async stop(): Promise<void> {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.feed.stop();
  }

  async listCameras(): Promise<Camera[]> {
    await this.withAuth(() => this.refreshCameras());
    return [...this.cameras.values()].map((c) => ({
      id: cameraId(this.name, c.id),
      adapter: this.name,
      externalId: c.id,
      name: c.name,
      model: c.model,
      online: !c.unreachable,
      health: c.malfunctioning ? "malfunctioning" : c.lowBattery ? "low battery" : undefined,
      privateIp: c.privateIp,
      supports: { live: true, snapshot: true, recordings: false },
    }));
  }

  getSnapshot(externalId: string): Promise<Snapshot> {
    return this.withAuth(() => this.client.getSnapshot(externalId));
  }

  getLiveSource(externalId: string): Promise<LiveSource> {
    return this.withAuth(() => this.client.getLiveSource(externalId));
  }

  onEvent(cb: (ev: CameraEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  status(): Record<string, unknown> {
    return {
      loggedIn: this.loggedIn,
      trustedDevice: Boolean(this.http.mfaCookie),
      cameras: this.cameras.size,
      eventFeed: this.feed.state,
      lastEventAt: this.feed.lastEventAt ?? null,
      lastFeedMessageAt: this.feed.lastMessageAt ?? null,
      lastError: this.lastError ?? null,
    };
  }

  private emit(ev: CameraEvent): void {
    for (const cb of this.listeners) {
      try {
        cb(ev);
      } catch (err) {
        log.error("Event listener threw", err);
      }
    }
  }

  private async refreshCameras(): Promise<void> {
    const list = await this.client.listCameras();
    this.cameras = new Map(list.map((c) => [c.id, c]));
    if (list[0]) log.debug("Camera attribute keys", list[0].attributeKeys);
  }

  private async keepAlive(): Promise<void> {
    try {
      await this.auth.keepAlive();
    } catch (err) {
      log.warn("Keep-alive failed; will re-login on next request", err);
      this.loggedIn = false;
    }
  }

  /** Reuse the saved session if it still works; otherwise log in again. */
  private async ensureLoggedIn(): Promise<void> {
    if (this.http.identityId && (await this.auth.isLoggedIn())) {
      this.loggedIn = true;
      this.lastError = undefined;
      log.info("Reusing saved Alarm.com session");
      return;
    }
    log.info("Logging in to Alarm.com");
    const result = await this.auth.login();
    if (result === "mfa_required") {
      this.loggedIn = false;
      this.lastError = "Two-factor code required. Run `npm run adc:login` in server/ once to trust this machine.";
      throw new AdcAuthError(this.lastError);
    }
    this.loggedIn = true;
    this.lastError = undefined;
  }

  /** Run a call; on an auth failure, log in once and retry. */
  private async withAuth<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof AdcAuthError)) throw err;
      log.warn("Session rejected, logging in again", err.message);
      if (!this.reloginInFlight) {
        this.reloginInFlight = this.auth
          .login()
          .then((r) => {
            if (r === "mfa_required") throw new AdcAuthError("Two-factor code required; run `npm run adc:login`");
            this.loggedIn = true;
            this.lastError = undefined;
          })
          .catch((e) => {
            this.loggedIn = false;
            this.lastError = e instanceof Error ? e.message : String(e);
            throw e;
          })
          .finally(() => {
            this.reloginInFlight = undefined;
          });
      }
      await this.reloginInFlight;
      return await fn();
    }
  }
}
