import { logger } from "../../log.js";
import type { IceServer, LiveSource } from "../types.js";
import { ACCEPT_JSON, AdcHttp, API_BASE } from "./http.js";

const log = logger("adc:client");

/** Live tokens rotate server-side; ask for a fresh set well before this. */
const LIVE_SOURCE_TTL_MS = 25 * 60 * 1000;

export interface AdcCamera {
  id: string;
  name: string;
  model?: string;
  unreachable: boolean;
  malfunctioning: boolean;
  lowBattery: boolean;
  privateIp?: string;
  firmwareVersion?: string;
  attributeKeys: string[];
}

interface JsonApiList {
  data: Array<{ id: string; type?: string; attributes?: Record<string, unknown> }>;
}

interface LiveSourceResponse {
  data?: { attributes?: Record<string, unknown> };
  included?: Array<{ type?: string; attributes?: Record<string, unknown> }>;
}

/** The JSON API calls that matter for cameras. Auth lives in AdcAuth. */
export class AdcClient {
  constructor(private readonly http: AdcHttp) {}

  async listCameras(): Promise<AdcCamera[]> {
    const res = await this.http.get(`${API_BASE}video/devices/cameras`);
    const body = await res.json<JsonApiList>();
    const items = Array.isArray(body.data) ? body.data : [body.data];
    return items.map((item) => {
      const a = item.attributes ?? {};
      return {
        id: String(item.id),
        name: str(a.description) ?? str(a.name) ?? `Camera ${item.id}`,
        model: str(a.deviceModel) ?? str(a.modelName) ?? str(a.deviceModelId),
        unreachable: Boolean(a.isUnreachable),
        malfunctioning: Boolean(a.isMalfunctioning),
        lowBattery: Boolean(a.lowBattery),
        privateIp: str(a.privateIp),
        firmwareVersion: str(a.firmwareVersion),
        attributeKeys: Object.keys(a),
      };
    });
  }

  async getSnapshot(id: string): Promise<{ data: Buffer; contentType: string }> {
    const res = await this.http.get(`${API_BASE}video/devices/cameras/${id}/snapshot`, { accept: "image/*,*/*" });
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    if (contentType.includes("json")) {
      // Some accounts hand back a JSON envelope pointing at the image.
      const body = await res.json<Record<string, unknown>>();
      const url = findUrl(body);
      if (!url) throw new Error("Snapshot response was JSON without an image URL");
      const img = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      return { data: Buffer.from(await img.arrayBuffer()), contentType: img.headers.get("content-type") ?? "image/jpeg" };
    }
    return { data: await res.buffer(), contentType };
  }

  /**
   * Alarm.com answers with two possible transports. "Proxy" means the browser
   * talks to a Janus gateway that pulls from the camera; "end to end" means a
   * custom signalling server brokers a direct WebRTC session with the camera.
   */
  async getLiveSource(id: string): Promise<LiveSource> {
    const res = await this.http.get(`${API_BASE}video/videoSources/liveVideoHighestResSources/${id}`, {
      accept: ACCEPT_JSON,
    });
    const body = await res.json<LiveSourceResponse>();
    const top = body.data?.attributes ?? {};
    const iceServers = parseIceServers(top.iceServers);
    const expiresAt = Date.now() + LIVE_SOURCE_TTL_MS;

    let endToEnd: Record<string, unknown> | undefined;
    let proxy: Record<string, unknown> | undefined;
    for (const inc of body.included ?? []) {
      if (inc.type === "video/videoSources/endToEndWebrtcConnectionInfo") endToEnd = inc.attributes ?? {};
      else if (inc.type === "video/videoSources/proxyWebrtcConnectionInfo") proxy = inc.attributes ?? {};
    }

    if (endToEnd && str(endToEnd.signallingServerUrl) && str(endToEnd.cameraAuthToken)) {
      return {
        kind: "webrtc-signalling",
        signallingServerUrl: str(endToEnd.signallingServerUrl)!,
        signallingServerToken: str(endToEnd.signallingServerToken) ?? "",
        cameraAuthToken: str(endToEnd.cameraAuthToken)!,
        iceServers,
        expiresAt,
      };
    }

    const gatewayUrl = str(top.janusGatewayUrl);
    const token = str(top.janusToken);
    if (gatewayUrl && token) {
      const suffix = id.split("-").pop() ?? "";
      const streamId = proxy && str(top.proxyUrl) ? null : /^\d+$/.test(suffix) ? Number(suffix) : null;
      return {
        kind: "janus",
        gatewayUrl,
        token,
        streamId,
        proxyUrl: str(top.proxyUrl),
        iceServers,
        expiresAt,
      };
    }

    log.warn("No usable live source in response", { id, included: (body.included ?? []).map((i) => i.type) });
    return { kind: "none", reason: "Alarm.com returned no WebRTC connection info for this camera" };
  }

  async getWebSocketToken(): Promise<{ endpoint: string; token: string }> {
    const res = await this.http.get(`${API_BASE}websockets/token`, { accept: ACCEPT_JSON });
    const body = await res.json<Record<string, unknown>>();
    const token = str(body.value) ?? str((body.data as Record<string, unknown> | undefined)?.value);
    const meta = (body.metadata ?? (body.data as Record<string, unknown> | undefined)?.metadata) as
      | Record<string, unknown>
      | undefined;
    const endpoint = str(meta?.endpoint);
    if (!token || !endpoint) throw new Error("WebSocket token response missing value or endpoint");
    return { endpoint, token };
  }
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function parseIceServers(raw: unknown): IceServer[] {
  if (Array.isArray(raw)) return raw as IceServer[];
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as IceServer[]) : [];
  } catch {
    return [];
  }
}

function findUrl(obj: unknown, depth = 0): string | undefined {
  if (depth > 4 || !obj || typeof obj !== "object") return undefined;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof v === "string" && /^https?:\/\//.test(v) && /url|src|image|snapshot/i.test(k)) return v;
    const nested = findUrl(v, depth + 1);
    if (nested) return nested;
  }
  return undefined;
}
