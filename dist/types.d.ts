export interface BaseInfo {
    channel_version?: string;
}
export declare const UploadMediaType: {
    readonly IMAGE: 1;
    readonly VIDEO: 2;
    readonly FILE: 3;
    readonly VOICE: 4;
};
export declare const MessageType: {
    readonly NONE: 0;
    readonly USER: 1;
    readonly BOT: 2;
};
export declare const MessageItemType: {
    readonly NONE: 0;
    readonly TEXT: 1;
    readonly IMAGE: 2;
    readonly VOICE: 3;
    readonly FILE: 4;
    readonly VIDEO: 5;
};
export declare const MessageState: {
    readonly NEW: 0;
    readonly GENERATING: 1;
    readonly FINISH: 2;
};
export declare const TypingStatus: {
    readonly TYPING: 1;
    readonly CANCEL: 2;
};
export interface TextItem {
    text?: string;
}
export interface CDNMedia {
    encrypt_query_param?: string;
    aes_key?: string;
    encrypt_type?: number;
}
export interface ImageItem {
    media?: CDNMedia;
    thumb_media?: CDNMedia;
    aeskey?: string;
    url?: string;
    mid_size?: number;
    thumb_size?: number;
    thumb_height?: number;
    thumb_width?: number;
    hd_size?: number;
}
export interface VoiceItem {
    media?: CDNMedia;
    encode_type?: number;
    bits_per_sample?: number;
    sample_rate?: number;
    playtime?: number;
    text?: string;
}
export interface FileItem {
    media?: CDNMedia;
    file_name?: string;
    md5?: string;
    len?: string;
}
export interface VideoItem {
    media?: CDNMedia;
    video_size?: number;
    play_length?: number;
    video_md5?: string;
    thumb_media?: CDNMedia;
    thumb_size?: number;
    thumb_height?: number;
    thumb_width?: number;
}
export interface RefMessage {
    message_item?: MessageItem;
    title?: string;
}
export interface MessageItem {
    type?: number;
    create_time_ms?: number;
    update_time_ms?: number;
    is_completed?: boolean;
    msg_id?: string;
    ref_msg?: RefMessage;
    text_item?: TextItem;
    image_item?: ImageItem;
    voice_item?: VoiceItem;
    file_item?: FileItem;
    video_item?: VideoItem;
}
export interface WeixinRawMessage {
    seq?: number;
    message_id?: number;
    from_user_id?: string;
    to_user_id?: string;
    client_id?: string;
    create_time_ms?: number;
    update_time_ms?: number;
    delete_time_ms?: number;
    session_id?: string;
    group_id?: string;
    message_type?: number;
    message_state?: number;
    item_list?: MessageItem[];
    context_token?: string;
}
export interface GetUpdatesResp {
    ret?: number;
    errcode?: number;
    errmsg?: string;
    msgs?: WeixinRawMessage[];
    get_updates_buf?: string;
    longpolling_timeout_ms?: number;
}
export interface GetUploadUrlReq {
    filekey?: string;
    media_type?: number;
    to_user_id?: string;
    rawsize?: number;
    rawfilemd5?: string;
    filesize?: number;
    thumb_rawsize?: number;
    thumb_rawfilemd5?: string;
    thumb_filesize?: number;
    no_need_thumb?: boolean;
    aeskey?: string;
}
export interface GetUploadUrlResp {
    upload_param?: string;
    thumb_upload_param?: string;
}
export interface SendMessageReq {
    msg?: WeixinRawMessage;
}
export interface SendTypingReq {
    ilink_user_id?: string;
    typing_ticket?: string;
    status?: number;
}
export interface SendTypingResp {
    ret?: number;
    errcode?: number;
    errmsg?: string;
}
export interface GetConfigResp {
    ret?: number;
    errcode?: number;
    errmsg?: string;
    typing_ticket?: string;
}
export interface LoginQrResponse {
    qrcode: string;
    qrcode_img_content: string;
}
export interface QrStatusResponse {
    status: "wait" | "scaned" | "confirmed" | "expired";
    bot_token?: string;
    ilink_bot_id?: string;
    baseurl?: string;
    ilink_user_id?: string;
}
export interface WeixinSession {
    token: string;
    accountId: string;
    userId?: string;
    baseUrl: string;
    cdnBaseUrl: string;
    routeTag?: string;
    syncBuffer?: string;
    contextTokens?: Record<string, string>;
    createdAt?: string;
    updatedAt?: string;
}
export interface SessionStore {
    load(): Promise<WeixinSession | null>;
    save(session: WeixinSession): Promise<void>;
    clear(): Promise<void>;
}
export interface WeixinChat {
    id: string;
    type: "private";
}
export interface WeixinUser {
    id: string;
}
export type WeixinBotMessageType = "text" | "photo" | "video" | "document" | "voice" | "unknown";
export interface WeixinMessageMediaBase {
    fileId: string;
    aesKey?: string;
}
export interface WeixinPhoto extends WeixinMessageMediaBase {
    kind: "photo";
    item: ImageItem;
}
export interface WeixinVideo extends WeixinMessageMediaBase {
    kind: "video";
    item: VideoItem;
}
export interface WeixinDocument extends WeixinMessageMediaBase {
    kind: "document";
    fileName?: string;
    item: FileItem;
}
export interface WeixinVoice extends WeixinMessageMediaBase {
    kind: "voice";
    transcript?: string;
    item: VoiceItem;
}
export type WeixinMessageMedia = WeixinPhoto | WeixinVideo | WeixinDocument | WeixinVoice;
export interface WeixinBotMessage {
    id: number | undefined;
    seq: number | undefined;
    type: WeixinBotMessageType;
    chat: WeixinChat;
    from: WeixinUser;
    date: number | undefined;
    text?: string;
    caption?: string;
    contextToken?: string;
    media?: WeixinMessageMedia;
    raw: WeixinRawMessage;
}
export type InputFile = string | URL | Buffer | Uint8Array | {
    source: Buffer | Uint8Array;
    filename?: string;
    contentType?: string;
};
export interface SendCommonOptions {
    contextToken?: string;
}
export interface SendMediaOptions extends SendCommonOptions {
    caption?: string;
    filename?: string;
    contentType?: string;
}
export interface PollingOptions {
    timeoutMs?: number;
    retryDelayMs?: number;
}
export interface DownloadMediaResult {
    buffer: Buffer;
    mimeType: string;
    fileName?: string;
}
export interface DownloadMediaOptions {
    filePath?: string;
}
export interface LoginSession {
    sessionKey: string;
    qrcode: string;
    qrCodeUrl: string;
    baseUrl: string;
    botType: string;
}
export interface WaitForLoginOptions {
    timeoutMs?: number;
    refreshExpiredQr?: boolean;
    signal?: AbortSignal;
}
export interface LoginResult {
    connected: boolean;
    message: string;
    session?: WeixinSession;
}
export type OnTextListener = (message: WeixinBotMessage, match: RegExpExecArray) => void | Promise<void>;
