import type { DownloadMediaOptions, DownloadMediaResult, InputFile, SendMessageReq, WeixinBotMessage } from "./types.js";
import { WeixinApiClient } from "./client.js";
export interface UploadedMedia {
    filekey: string;
    downloadEncryptedQueryParam: string;
    aeskeyHex: string;
    fileSize: number;
    fileSizeCiphertext: number;
    fileName: string;
    contentType: string;
}
export declare function uploadMedia(params: {
    client: WeixinApiClient;
    input: InputFile;
    toUserId: string;
    mediaType: number;
    filename?: string;
    contentType?: string;
}): Promise<UploadedMedia>;
export declare function buildTextMessage(params: {
    to: string;
    text: string;
    contextToken: string;
}): SendMessageReq;
export declare function sendImage(params: {
    client: WeixinApiClient;
    to: string;
    contextToken: string;
    uploaded: UploadedMedia;
    caption?: string;
}): Promise<string>;
export declare function sendVideo(params: {
    client: WeixinApiClient;
    to: string;
    contextToken: string;
    uploaded: UploadedMedia;
    caption?: string;
}): Promise<string>;
export declare function sendDocument(params: {
    client: WeixinApiClient;
    to: string;
    contextToken: string;
    uploaded: UploadedMedia;
    caption?: string;
}): Promise<string>;
export declare function downloadMedia(params: {
    client: WeixinApiClient;
    message: WeixinBotMessage;
    options?: DownloadMediaOptions;
}): Promise<DownloadMediaResult>;
export declare function resolveUploadMediaType(contentType: string): number;
