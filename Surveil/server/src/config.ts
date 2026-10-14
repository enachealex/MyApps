import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface AlarmComConfig {
  enabled: boolean;
  username: string;
  password: string;
  /** Name registered with Alarm.com when trusting this device for 2FA. */
  deviceName?: string;
}

export interface Config {
  port: number;
  dataDir: string;
  adapters: {
    demo?: { enabled: boolean };
    alarmcom?: AlarmComConfig;
  };
  alerts: { ntfy?: string; cooldownSec: number };
  cameraRefreshSec: number;
}

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const defaults: Config = {
  port: 8080,
  dataDir: "./data",
  adapters: { demo: { enabled: true } },
  alerts: { cooldownSec: 60 },
  cameraRefreshSec: 60,
};

/**
 * Loads server/config.json (override the path with SURVEIL_CONFIG). A missing
 * file means demo-only defaults, so the app runs before any camera exists.
 */
export function loadConfig(): Config & { serverRoot: string; configPath: string } {
  const configPath = path.resolve(serverRoot, process.env.SURVEIL_CONFIG || "config.json");
  let fileCfg: Partial<Config> = {};
  if (fs.existsSync(configPath)) {
    fileCfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
  }
  const cfg: Config = {
    ...defaults,
    ...fileCfg,
    adapters: { ...defaults.adapters, ...(fileCfg.adapters || {}) },
    alerts: { ...defaults.alerts, ...(fileCfg.alerts || {}) },
  };
  if (process.env.PORT) cfg.port = Number(process.env.PORT);
  cfg.dataDir = path.resolve(serverRoot, cfg.dataDir);
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  return { ...cfg, serverRoot, configPath };
}
