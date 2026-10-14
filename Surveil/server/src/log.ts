/** Tiny leveled logger. Everything goes to stdout so journald captures it. */
type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = order[(process.env.LOG_LEVEL as Level) || "info"] ?? 20;

export function logger(scope: string) {
  const emit = (level: Level, msg: string, extra?: unknown) => {
    if (order[level] < threshold) return;
    const ts = new Date().toISOString();
    const tail = extra === undefined ? "" : " " + safe(extra);
    console.log(`${ts} ${level.padEnd(5)} [${scope}] ${msg}${tail}`);
  };
  return {
    debug: (m: string, e?: unknown) => emit("debug", m, e),
    info: (m: string, e?: unknown) => emit("info", m, e),
    warn: (m: string, e?: unknown) => emit("warn", m, e),
    error: (m: string, e?: unknown) => emit("error", m, e),
  };
}

function safe(v: unknown): string {
  if (v instanceof Error) return v.stack || v.message;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
