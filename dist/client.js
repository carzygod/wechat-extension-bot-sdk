import { DEFAULT_API_TIMEOUT_MS, DEFAULT_BASE_URL, DEFAULT_CDN_BASE_URL, DEFAULT_LIGHT_API_TIMEOUT_MS, DEFAULT_LONG_POLL_TIMEOUT_MS, } from "./constants.js";
import { SessionExpiredError, WeixinSdkError } from "./errors.js";
import { buildBaseInfo, ensureTrailingSlash, randomWechatUin, withTimeout } from "./utils.js";
export class WeixinApiClient {
    baseUrl;
    cdnBaseUrl;
    token;
    routeTag;
    constructor(options = {}) {
        this.baseUrl = options.baseUrl?.trim() || DEFAULT_BASE_URL;
        this.cdnBaseUrl = options.cdnBaseUrl?.trim() || DEFAULT_CDN_BASE_URL;
        this.token = options.token?.trim() || undefined;
        this.routeTag = options.routeTag?.trim() || undefined;
    }
    setSession(options) {
        if (options.baseUrl?.trim())
            this.baseUrl = options.baseUrl.trim();
        if (options.cdnBaseUrl?.trim())
            this.cdnBaseUrl = options.cdnBaseUrl.trim();
        if (options.token !== undefined)
            this.token = options.token?.trim() || undefined;
        if (options.routeTag !== undefined)
            this.routeTag = options.routeTag?.trim() || undefined;
    }
    buildJsonHeaders(body, token) {
        const headers = {
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
    buildSimpleHeaders() {
        const headers = {};
        if (this.routeTag)
            headers.SKRouteTag = this.routeTag;
        return headers;
    }
    async postJson(params) {
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
                throw new WeixinSdkError("HTTP_ERROR", `HTTP ${response.status} ${response.statusText}: ${raw}`);
            }
            return JSON.parse(raw);
        }
        finally {
            cancel();
        }
    }
    async createLoginQr(params) {
        const url = new URL(`ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(params?.botType ?? "3")}`, ensureTrailingSlash(this.baseUrl));
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
            return JSON.parse(raw);
        }
        finally {
            cancel();
        }
    }
    async getQrCodeStatus(params) {
        const url = new URL(`ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(params.qrcode)}`, ensureTrailingSlash(this.baseUrl));
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
            return JSON.parse(raw);
        }
        catch (error) {
            if (controller.signal.aborted) {
                return { status: "wait" };
            }
            throw error;
        }
        finally {
            controller.cancel();
        }
    }
    async getUpdates(params) {
        try {
            return await this.postJson({
                endpoint: "ilink/bot/getupdates",
                body: {
                    get_updates_buf: params.getUpdatesBuf ?? "",
                },
                timeoutMs: params.timeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS,
            });
        }
        catch (error) {
            if (error instanceof Error && error.name === "AbortError") {
                return { ret: 0, msgs: [], get_updates_buf: params.getUpdatesBuf ?? "" };
            }
            throw error;
        }
    }
    async getUploadUrl(params) {
        return this.postJson({
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
    async sendMessage(body, timeoutMs) {
        const response = await this.postJson({
            endpoint: "ilink/bot/sendmessage",
            body,
            timeoutMs: timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
        });
        if ((response.errcode ?? response.ret ?? 0) === -14) {
            throw new SessionExpiredError(response.errmsg ?? "Weixin session expired");
        }
        if ((response.errcode ?? 0) !== 0 || (response.ret ?? 0) !== 0) {
            throw new WeixinSdkError("API_ERROR", `sendmessage failed: ret=${response.ret ?? ""} errcode=${response.errcode ?? ""} errmsg=${response.errmsg ?? ""}`.trim());
        }
    }
    async getConfig(params) {
        const response = await this.postJson({
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
    async sendTyping(body, timeoutMs) {
        const response = await this.postJson({
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
//# sourceMappingURL=client.js.map