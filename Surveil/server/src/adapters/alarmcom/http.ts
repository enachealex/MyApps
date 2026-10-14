import fs from "node:fs";
import { logger } from "../../log.js";

export const URL_BASE = "https://www.alarm.com/";
export const API_BASE = URL_BASE + "web/api/";
export const MFA_COOKIE = "twoFactorAuthenticationId";
export const AJAX_COOKIE = "afg";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";
const REFERER = "https://www.alarm.com/web/system/home";

export const ACCEPT_HTML = "text/html,application/xhtml+xml,application/xml";
export const ACCEPT_JSONAPI = "application/vnd.api+json";
export const ACCEPT_JSON = "application/json";

const log = logger("adc:http");

export class AdcAuthError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "AdcAuthError";
  }
}

export interface SessionState {
  cookies: Record<string, string>;
  identityId?: string;
  keepAliveUrl?: string;
  keepAliveMs?: number;
  savedAt: number;
}

export interface RequestOptions {
  method?: "GET" | "POST";
  accept?: string;
  /** Send the Ajaxrequestuniquekey header (from the `afg` cookie). Default true. */
  ajax?: boolean;
  form?: Record<string, string>;
  json?: unknown;
  timeoutMs?: number;
}

export interface AdcResponse {
  status: number;
  finalUrl: string;
  headers: Headers;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
  buffer(): Promise<Buffer>;
}

/**
 * Minimal cookie-jar HTTP client for www.alarm.com. Follows redirects by
 * hand so Set-Cookie on intermediate hops is not lost, and persists the jar
 * to disk so the 2FA trusted-device cookie survives restarts.
 */
export class AdcHttp {
  readonly cookies = new Map<string, string>();
  identityId?: string;
  keepAliveUrl?: string;
  keepAliveMs?: number;

  constructor(private readonly sessionFile: string) {}

  get ajaxKey(): string | undefined {
    return this.cookies.get(AJAX_COOKIE);
  }

  get mfaCookie(): string | undefined {
    return this.cookies.get(MFA_COOKIE);
  }

  load(): boolean {
    if (!fs.existsSync(this.sessionFile)) return false;
    try {
      const state = JSON.parse(fs.readFileSync(this.sessionFile, "utf8")) as SessionState;
      this.cookies.clear();
      for (const [k, v] of Object.entries(state.cookies || {})) this.cookies.set(k, v);
      this.identityId = state.identityId;
      this.keepAliveUrl = state.keepAliveUrl;
      this.keepAliveMs = state.keepAliveMs;
      return true;
    } catch (err) {
      log.warn("Could not read session file, starting fresh", err);
      return false;
    }
  }

  save(): void {
    const state: SessionState = {
      cookies: Object.fromEntries(this.cookies),
      identityId: this.identityId,
      keepAliveUrl: this.keepAliveUrl,
      keepAliveMs: this.keepAliveMs,
      savedAt: Date.now(),
    };
    fs.writeFileSync(this.sessionFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  }

  /** Forget everything except the 2FA trusted-device cookie. */
  resetSession(): void {
    const mfa = this.mfaCookie;
    this.cookies.clear();
    if (mfa) this.cookies.set(MFA_COOKIE, mfa);
    this.identityId = undefined;
    this.keepAliveUrl = undefined;
    this.keepAliveMs = undefined;
  }

  private absorbCookies(res: Response): void {
    const setCookies = res.headers.getSetCookie?.() ?? [];
    for (const line of setCookies) {
      const first = line.split(";", 1)[0];
      const eq = first.indexOf("=");
      if (eq < 1) continue;
      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();
      if (value === "" || value.toLowerCase() === "deleted") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  private cookieHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  async request(url: string, opts: RequestOptions = {}): Promise<AdcResponse> {
    const method = opts.method ?? "GET";
    let body: string | undefined;
    const headers: Record<string, string> = {
      "User-Agent": USER_AGENT,
      Referer: REFERER,
      Connection: "keep-alive",
      Accept: opts.accept ?? ACCEPT_JSONAPI,
    };
    if (opts.ajax !== false && this.ajaxKey) headers["Ajaxrequestuniquekey"] = this.ajaxKey;
    if (opts.form) {
      body = new URLSearchParams(opts.form).toString();
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    } else if (opts.json !== undefined) {
      body = JSON.stringify(opts.json);
      headers["Content-Type"] = "application/json";
    }

    let currentUrl = url;
    let currentMethod = method;
    let currentBody = body;
    let res: Response | undefined;

    for (let hop = 0; hop < 6; hop++) {
      const cookie = this.cookieHeader();
      res = await fetch(currentUrl, {
        method: currentMethod,
        headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) },
        body: currentBody,
        redirect: "manual",
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
      });
      this.absorbCookies(res);

      const location = res.headers.get("location");
      if ([301, 302, 303, 307, 308].includes(res.status) && location) {
        currentUrl = new URL(location, currentUrl).toString();
        if (res.status !== 307 && res.status !== 308) {
          currentMethod = "GET";
          currentBody = undefined;
          delete headers["Content-Type"];
        }
        await res.arrayBuffer().catch(() => undefined);
        continue;
      }
      break;
    }
    if (!res) throw new Error("No response");

    const finalUrl = currentUrl;
    if (res.status === 401 || res.status === 403) {
      throw new AdcAuthError(`Alarm.com rejected the request (${res.status}) for ${url}`, res.status);
    }
    if (/\/login(\.aspx)?(\?|$)/i.test(finalUrl) && !/\/login$/i.test(url)) {
      throw new AdcAuthError(`Alarm.com redirected to the login page for ${url}`, res.status);
    }

    const response = res;
    return {
      status: response.status,
      finalUrl,
      headers: response.headers,
      text: () => response.text(),
      json: async <T,>() => (await response.json()) as T,
      buffer: async () => Buffer.from(await response.arrayBuffer()),
    };
  }

  get(url: string, opts: Omit<RequestOptions, "method"> = {}): Promise<AdcResponse> {
    return this.request(url, { ...opts, method: "GET" });
  }

  post(url: string, opts: Omit<RequestOptions, "method"> = {}): Promise<AdcResponse> {
    return this.request(url, { ...opts, method: "POST" });
  }
}
