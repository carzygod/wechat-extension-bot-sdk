import { DEFAULT_BOT_TYPE, DEFAULT_CDN_BASE_URL } from "./constants.js";
import { WeixinSdkError } from "./errors.js";
import type { LoginResult, LoginSession, WaitForLoginOptions, WeixinSession } from "./types.js";
import { randomId, sleep } from "./utils.js";
import { WeixinApiClient } from "./client.js";

const MAX_QR_REFRESH_COUNT = 3;

export class WeixinAuthManager {
  private readonly client: WeixinApiClient;
  private readonly sessions = new Map<string, LoginSession>();

  constructor(client: WeixinApiClient) {
    this.client = client;
  }

  async createLoginSession(options?: { botType?: string; timeoutMs?: number; signal?: AbortSignal }): Promise<LoginSession> {
    const qr = await this.client.createLoginQr({
      botType: options?.botType ?? DEFAULT_BOT_TYPE,
      timeoutMs: options?.timeoutMs,
      signal: options?.signal,
    });

    const session: LoginSession = {
      sessionKey: randomId("weixin-login"),
      qrcode: qr.qrcode,
      qrCodeUrl: qr.qrcode_img_content,
      baseUrl: this.client.baseUrl,
      botType: options?.botType ?? DEFAULT_BOT_TYPE,
    };

    this.sessions.set(session.sessionKey, session);
    return session;
  }

  async waitForLogin(sessionKey: string, options: WaitForLoginOptions = {}): Promise<LoginResult> {
    const active = this.sessions.get(sessionKey);
    if (!active) {
      throw new WeixinSdkError("LOGIN_SESSION_NOT_FOUND", `Unknown login session: ${sessionKey}`);
    }

    const timeoutMs = Math.max(options.timeoutMs ?? 480_000, 1_000);
    const deadline = Date.now() + timeoutMs;
    let refreshCount = 0;

    while (Date.now() < deadline) {
      if (options.signal?.aborted) {
        throw options.signal.reason instanceof Error ? options.signal.reason : new Error("aborted");
      }

      const status = await this.client.getQrCodeStatus({
        qrcode: active.qrcode,
        timeoutMs: 35_000,
        signal: options.signal,
      });

      if (status.status === "confirmed") {
        if (!status.bot_token || !status.ilink_bot_id) {
          return {
            connected: false,
            message: "Login confirmed but upstream response is missing token or account id.",
          };
        }

        const session: WeixinSession = {
          token: status.bot_token,
          accountId: status.ilink_bot_id,
          userId: status.ilink_user_id,
          baseUrl: status.baseurl?.trim() || active.baseUrl || this.client.baseUrl,
          cdnBaseUrl: this.client.cdnBaseUrl || DEFAULT_CDN_BASE_URL,
          routeTag: this.client.routeTag,
          syncBuffer: "",
          contextTokens: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        this.sessions.delete(sessionKey);
        return {
          connected: true,
          message: "Login successful",
          session,
        };
      }

      if (status.status === "expired") {
        if (options.refreshExpiredQr === false) {
          this.sessions.delete(sessionKey);
          return { connected: false, message: "QR code expired" };
        }

        refreshCount += 1;
        if (refreshCount > MAX_QR_REFRESH_COUNT) {
          this.sessions.delete(sessionKey);
          return { connected: false, message: "QR code expired too many times" };
        }

        const refreshed = await this.client.createLoginQr({ botType: active.botType, signal: options.signal });
        active.qrcode = refreshed.qrcode;
        active.qrCodeUrl = refreshed.qrcode_img_content;
      }

      await sleep(1_000, options.signal);
    }

    this.sessions.delete(sessionKey);
    return {
      connected: false,
      message: "Login timed out",
    };
  }

  async loginWithQr(options?: {
    botType?: string;
    timeoutMs?: number;
    refreshExpiredQr?: boolean;
    signal?: AbortSignal;
  }): Promise<{ loginSession: LoginSession; result: LoginResult }> {
    const loginSession = await this.createLoginSession({
      botType: options?.botType,
      signal: options?.signal,
    });
    const result = await this.waitForLogin(loginSession.sessionKey, {
      timeoutMs: options?.timeoutMs,
      refreshExpiredQr: options?.refreshExpiredQr,
      signal: options?.signal,
    });

    return { loginSession, result };
  }
}
