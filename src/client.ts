import {
  DEFAULT_API_TIMEOUT_MS,
  DEFAULT_BASE_URL,
  DEFAULT_CDN_BASE_URL,
  DEFAULT_LIGHT_API_TIMEOUT_MS,
  DEFAULT_LONG_POLL_TIMEOUT_MS,
} from "./constants.js";
import { SessionExpiredError, WeixinSdkError } from "./errors.js";
import type {
  GetConfigResp,
  GetUpdatesResp,
  GetUploadUrlReq,
  GetUploadUrlResp,
  LoginQrResponse,
  QrStatusResponse,
  SendMessageReq,
  SendTypingReq,
  SendTypingResp,
} from "./types.js";
import { buildBaseInfo, ensureTrailingSlash, randomWechatUin, withTimeout } from "./utils.js";

export interface WeixinApiClientOptions {
  baseUrl?: string;
  cdnBaseUrl?: string;
  token?: string;
  routeTag?: string;
}

export class WeixinApiClient {
  baseUrl: string;
  cdnBaseUrl: string;
  token?: string;
  routeTag?: string;

  constructor(options: WeixinApiClientOptions = {}) {
    this.baseUrl = options.baseUrl?.trim() || DEFAULT_BASE_URL;
    this.cdnBaseUrl = options.cdnBaseUrl?.trim() || DEFAULT_CDN_BASE_URL;
    this.token = options.token?.trim() || undefined;
    this.routeTag = options.routeTag?.trim() || undefined;
  }

  setSession(options: WeixinApiClientOptions): void {
    if (options.baseUrl?.trim()) this.baseUrl = options.baseUrl.trim();
    if (options.cdnBaseUrl?.trim()) this.cdnBaseUrl = options.cdnBaseUrl.trim();
    if (options.token !== undefined) this.token = options.token?.trim() || undefined;
    if (options.routeTag !== undefined) this.routeTag = options.routeTag?.trim() || undefined;
  }

  private buildJsonHeaders(body: string, token?: string): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      AuthorizationType: "ilink_bot_token",
      "Content-Length": String(Buffer.byteLength(body, "utf-8")),
      "X-WECHAT-UIN": randomWechatUin(),
    };

    if (token?.trim()) {
      headers.Authorization = `Bearer ${token.trim()}`;
    }

    if (this.routeTag) {
      headers.SKRouteTag = this.routeTag;
    }

    return headers;
  }

  private buildSimpleHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.routeTag) headers.SKRouteTag = this.routeTag;
    return headers;
  }

  private async postJson<T>(params: {
    endpoint: string;
    body: object;
    timeoutMs?: number;
    token?: string;
  }): Promise<T> {
    const body = JSON.stringify({ ...params.body, base_info: buildBaseInfo() });
    const { signal, cancel } = withTimeout(params.timeoutMs ?? DEFAULT_API_TIMEOUT_MS);

    try {
      const response = await fetch(new URL(params.endpoint, ensureTrailingSlash(this.baseUrl)), {
        method: "POST",
        headers: this.buildJsonHeaders(body, params.token ?? this.token),
        body,
        signal,
      });

      const raw = await response.text();
      if (!response.ok) {
        throw new WeixinSdkError(
          "HTTP_ERROR",
          `HTTP ${response.status} ${response.statusText}: ${raw}`,
        );
      }

      return JSON.parse(raw) as T;
    } finally {
      cancel();
    }
  }

  async createLoginQr(params?: {
    botType?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<LoginQrResponse> {
    const url = new URL(
      `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(params?.botType ?? "3")}`,
      ensureTrailingSlash(this.baseUrl),
    );
    const { signal, cancel } = withTimeout(params?.timeoutMs ?? DEFAULT_LIGHT_API_TIMEOUT_MS, params?.signal);
    try {
      const response = await fetch(url, {
        headers: this.buildSimpleHeaders(),
        signal,
      });
      const raw = await response.text();
      if (!response.ok) {
        throw new WeixinSdkError("HTTP_ERROR", `HTTP ${response.status} ${response.statusText}: ${raw}`);
      }
      return JSON.parse(raw) as LoginQrResponse;
    } finally {
      cancel();
    }
  }

  async getQrCodeStatus(params: {
    qrcode: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<QrStatusResponse> {
    const url = new URL(
      `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(params.qrcode)}`,
      ensureTrailingSlash(this.baseUrl),
    );

    const controller = withTimeout(params.timeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS, params.signal);
    try {
      const response = await fetch(url, {
        headers: {
          "iLink-App-ClientVersion": "1",
          ...this.buildSimpleHeaders(),
        },
        signal: controller.signal,
      });
      const raw = await response.text();
      if (!response.ok) {
        throw new WeixinSdkError("HTTP_ERROR", `HTTP ${response.status} ${response.statusText}: ${raw}`);
      }
      return JSON.parse(raw) as QrStatusResponse;
    } catch (error) {
      if (controller.signal.aborted) {
        return { status: "wait" };
      }
      throw error;
    } finally {
      controller.cancel();
    }
  }

  async getUpdates(params: {
    getUpdatesBuf?: string;
    timeoutMs?: number;
  }): Promise<GetUpdatesResp> {
    try {
      return await this.postJson<GetUpdatesResp>({
        endpoint: "ilink/bot/getupdates",
        body: {
          get_updates_buf: params.getUpdatesBuf ?? "",
        },
        timeoutMs: params.timeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return { ret: 0, msgs: [], get_updates_buf: params.getUpdatesBuf ?? "" };
      }
      throw error;
    }
  }

  async getUploadUrl(params: GetUploadUrlReq & { timeoutMs?: number }): Promise<GetUploadUrlResp> {
    return this.postJson<GetUploadUrlResp>({
      endpoint: "ilink/bot/getuploadurl",
      body: {
        filekey: params.filekey,
        media_type: params.media_type,
        to_user_id: params.to_user_id,
        rawsize: params.rawsize,
        rawfilemd5: params.rawfilemd5,
        filesize: params.filesize,
        thumb_rawsize: params.thumb_rawsize,
        thumb_rawfilemd5: params.thumb_rawfilemd5,
        thumb_filesize: params.thumb_filesize,
        no_need_thumb: params.no_need_thumb,
        aeskey: params.aeskey,
      },
      timeoutMs: params.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
    });
  }

  async sendMessage(body: SendMessageReq, timeoutMs?: number): Promise<void> {
    const response = await this.postJson<{ ret?: number; errcode?: number; errmsg?: string }>({
      endpoint: "ilink/bot/sendmessage",
      body,
      timeoutMs: timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
    });

    if ((response.errcode ?? response.ret ?? 0) === -14) {
      throw new SessionExpiredError(response.errmsg ?? "Weixin session expired");
    }

    if ((response.errcode ?? 0) !== 0 || (response.ret ?? 0) !== 0) {
      throw new WeixinSdkError(
        "API_ERROR",
        `sendmessage failed: ret=${response.ret ?? ""} errcode=${response.errcode ?? ""} errmsg=${response.errmsg ?? ""}`.trim(),
      );
    }
  }

  async getConfig(params: {
    ilinkUserId: string;
    contextToken?: string;
    timeoutMs?: number;
  }): Promise<GetConfigResp> {
    const response = await this.postJson<GetConfigResp>({
      endpoint: "ilink/bot/getconfig",
      body: {
        ilink_user_id: params.ilinkUserId,
        context_token: params.contextToken,
      },
      timeoutMs: params.timeoutMs ?? DEFAULT_LIGHT_API_TIMEOUT_MS,
    });

    if ((response.errcode ?? response.ret ?? 0) === -14) {
      throw new SessionExpiredError(response.errmsg ?? "Weixin session expired");
    }

    return response;
  }

  async sendTyping(body: SendTypingReq, timeoutMs?: number): Promise<SendTypingResp> {
    const response = await this.postJson<SendTypingResp>({
      endpoint: "ilink/bot/sendtyping",
      body,
      timeoutMs: timeoutMs ?? DEFAULT_LIGHT_API_TIMEOUT_MS,
    });

    if ((response.errcode ?? response.ret ?? 0) === -14) {
      throw new SessionExpiredError(response.errmsg ?? "Weixin session expired");
    }

    return response;
  }
}
