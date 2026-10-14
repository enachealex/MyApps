import { logger } from "../../log.js";
import { ACCEPT_HTML, ACCEPT_JSON, AdcAuthError, AdcHttp, API_BASE, URL_BASE } from "./http.js";

const log = logger("adc:auth");

const TWO_FACTOR_PATH = "engines/twoFactorAuthentication/twoFactorAuthentications";

export enum OtpType {
  app = 1,
  sms = 2,
  email = 4,
}

export const otpLabel: Record<OtpType, string> = {
  [OtpType.app]: "authenticator app",
  [OtpType.sms]: "SMS",
  [OtpType.email]: "email",
};

export type LoginResult = "ok" | "mfa_required";

interface IdentityResponse {
  data: Array<{
    id: string;
    attributes?: {
      applicationSessionProperties?: {
        keepAliveUrl?: string;
        inactivityWarningTimeoutMs?: number;
        enableKeepAlive?: boolean;
      };
    };
  }> | { id: string; attributes?: Record<string, unknown> };
}

interface MfaResponse {
  data?: { attributes?: { enabledTwoFactorTypes?: number; isCurrentDeviceTrusted?: boolean } };
}

/**
 * Alarm.com has no login API. The website is an ASP.NET WebForms page: we
 * fetch it, lift the hidden __VIEWSTATE-style fields, and POST the form
 * exactly as a browser would. After that every call is a JSON API call
 * authenticated by cookies plus the `afg` cookie echoed as a header.
 */
export class AdcAuth {
  constructor(
    private readonly http: AdcHttp,
    private readonly username: string,
    private readonly password: string,
    private readonly deviceName = "Surveil",
  ) {}

  async login(): Promise<LoginResult> {
    if (!this.username || !this.password) throw new Error("Alarm.com username and password are required");
    this.http.resetSession();

    log.info("Loading login page");
    const page = await this.http.get(`${URL_BASE}login`, { accept: ACCEPT_HTML, ajax: false });
    const html = await page.text();
    const fields = extractHiddenFields(html, ["__VIEWSTATE", "__VIEWSTATEGENERATOR", "__EVENTVALIDATION", "__PREVIOUSPAGE"]);
    if (!fields.__VIEWSTATE || !fields.__EVENTVALIDATION) {
      throw new Error("Login page did not contain the expected form fields; Alarm.com may have changed its login page");
    }

    log.info("Submitting credentials");
    const res = await this.http.post(`${URL_BASE}web/Default.aspx`, {
      accept: ACCEPT_HTML,
      form: {
        "ctl00$ContentPlaceHolder1$loginform$txtUserName": this.username,
        txtPassword: this.password,
        __VIEWSTATE: fields.__VIEWSTATE,
        __VIEWSTATEGENERATOR: fields.__VIEWSTATEGENERATOR ?? "",
        __EVENTVALIDATION: fields.__EVENTVALIDATION,
        __PREVIOUSPAGE: fields.__PREVIOUSPAGE ?? "",
        __EVENTTARGET: "",
        __EVENTARGUMENT: "",
        __VIEWSTATEENCRYPTED: "",
        IsFromNewSite: "1",
      },
    });
    await res.text();
    if (/m=login_fail/i.test(res.finalUrl)) throw new AdcAuthError("Login failed: bad username or password");
    if (/m=LockedOut/i.test(res.finalUrl)) throw new AdcAuthError("Login failed: account is locked out");

    await this.loadIdentity();
    const mfa = await this.checkMfa();
    this.http.save();
    return mfa.required ? "mfa_required" : "ok";
  }

  async loadIdentity(): Promise<void> {
    const res = await this.http.get(`${API_BASE}identities`);
    const body = await res.json<IdentityResponse>();
    const first = Array.isArray(body.data) ? body.data[0] : body.data;
    if (!first?.id) throw new AdcAuthError("Identity response had no id; not logged in");
    this.http.identityId = first.id;
    const sessionProps = (
      first.attributes as
        | { applicationSessionProperties?: { keepAliveUrl?: string; inactivityWarningTimeoutMs?: number; enableKeepAlive?: boolean } }
        | undefined
    )?.applicationSessionProperties;
    if (sessionProps?.enableKeepAlive !== false && sessionProps?.keepAliveUrl) {
      this.http.keepAliveUrl = sessionProps.keepAliveUrl;
      this.http.keepAliveMs = sessionProps.inactivityWarningTimeoutMs || 5 * 60 * 1000;
    }
    log.debug("Identity loaded", { identityId: this.http.identityId, keepAlive: this.http.keepAliveUrl });
  }

  async checkMfa(): Promise<{ required: boolean; methods: OtpType[]; trusted: boolean }> {
    const res = await this.http.get(`${API_BASE}${TWO_FACTOR_PATH}/${this.http.identityId}`);
    const body = await res.json<MfaResponse>();
    const attrs = body.data?.attributes ?? {};
    const mask = attrs.enabledTwoFactorTypes ?? 0;
    const trusted = attrs.isCurrentDeviceTrusted ?? false;
    const methods = [OtpType.app, OtpType.sms, OtpType.email].filter((m) => (mask & m) !== 0);
    return { required: mask !== 0 && !trusted, methods, trusted };
  }

  /** Ask Alarm.com to send a code. No-op for authenticator apps. */
  async requestOtp(method: OtpType): Promise<void> {
    if (method === OtpType.app) return;
    const action = method === OtpType.sms ? "sendTwoFactorAuthenticationCodeViaSms" : "sendTwoFactorAuthenticationCodeViaEmail";
    const res = await this.http.post(`${API_BASE}${TWO_FACTOR_PATH}/${this.http.identityId}/${action}`, {
      accept: ACCEPT_JSON,
      json: {},
    });
    await res.text();
  }

  /** Verify the code and register this machine as a trusted device. */
  async submitOtp(code: string, method: OtpType): Promise<void> {
    const base = `${API_BASE}${TWO_FACTOR_PATH}/${this.http.identityId}`;
    const verify = await this.http.post(`${base}/verifyTwoFactorCode`, {
      accept: ACCEPT_JSON,
      json: { code, typeOf2FA: method },
    });
    const verifyText = await verify.text();
    if (verify.status >= 300) throw new AdcAuthError(`Code rejected (${verify.status}): ${verifyText.slice(0, 200)}`);

    try {
      const trust = await this.http.post(`${base}/trustTwoFactorDevice`, {
        accept: ACCEPT_JSON,
        json: { deviceName: this.deviceName },
      });
      await trust.text();
    } catch (err) {
      log.warn("Trusting this device failed; you may be asked for a code again next login", err);
    }
    if (!this.http.mfaCookie) {
      throw new AdcAuthError("Code accepted but Alarm.com did not return the trusted-device cookie");
    }
    this.http.save();
  }

  /** Cheap "am I still logged in" probe. Also doubles as a keep-alive. */
  async isLoggedIn(): Promise<boolean> {
    try {
      const res = await this.http.get(`${API_BASE}identities`);
      const body = await res.json<IdentityResponse>();
      const first = Array.isArray(body.data) ? body.data[0] : body.data;
      return Boolean(first?.id);
    } catch (err) {
      if (err instanceof AdcAuthError) return false;
      throw err;
    }
  }

  async keepAlive(): Promise<void> {
    if (!this.http.keepAliveUrl) {
      await this.isLoggedIn();
      return;
    }
    const url = `${URL_BASE.replace(/\/$/, "")}${this.http.keepAliveUrl}?timestamp=${Math.round(Date.now() / 1000)}`;
    const res = await this.http.post(url, { accept: ACCEPT_JSON });
    await res.text();
  }
}

function extractHiddenFields(html: string, ids: string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const id of ids) {
    const tag = html.match(new RegExp(`<input[^>]*\\bid="${id}"[^>]*>`, "i"))?.[0];
    const value = tag?.match(/\bvalue="([^"]*)"/i)?.[1];
    out[id] = value === undefined ? undefined : decodeHtml(value);
  }
  return out;
}

function decodeHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
