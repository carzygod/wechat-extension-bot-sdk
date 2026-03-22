import type { GetConfigResp, GetUpdatesResp, GetUploadUrlReq, GetUploadUrlResp, LoginQrResponse, QrStatusResponse, SendMessageReq, SendTypingReq, SendTypingResp } from "./types.js";
export interface WeixinApiClientOptions {
    baseUrl?: string;
    cdnBaseUrl?: string;
    token?: string;
    routeTag?: string;
}
export declare class WeixinApiClient {
    baseUrl: string;
    cdnBaseUrl: string;
    token?: string;
    routeTag?: string;
    constructor(options?: WeixinApiClientOptions);
    setSession(options: WeixinApiClientOptions): void;
    private buildJsonHeaders;
    private buildSimpleHeaders;
    private postJson;
    createLoginQr(params?: {
        botType?: string;
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<LoginQrResponse>;
    getQrCodeStatus(params: {
        qrcode: string;
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<QrStatusResponse>;
    getUpdates(params: {
        getUpdatesBuf?: string;
        timeoutMs?: number;
    }): Promise<GetUpdatesResp>;
    getUploadUrl(params: GetUploadUrlReq & {
        timeoutMs?: number;
    }): Promise<GetUploadUrlResp>;
    sendMessage(body: SendMessageReq, timeoutMs?: number): Promise<void>;
    getConfig(params: {
        ilinkUserId: string;
        contextToken?: string;
        timeoutMs?: number;
    }): Promise<GetConfigResp>;
    sendTyping(body: SendTypingReq, timeoutMs?: number): Promise<SendTypingResp>;
}
