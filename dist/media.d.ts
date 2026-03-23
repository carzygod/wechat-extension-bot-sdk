import type { DownloadMediaOptions, DownloadMediaResult, InputFile, SendMessageReq, WeixinBotMessage } from "./types.js";
import { WeixinApiClient } from "./client.js";
export { markdownToPlainText } from "./utils.js";
export interface UploadedMedia {
    filekey: string;
    downloadEncryptedQueryParam: string;
    aeskeyHex: string;
    fileSize: number;
    fileSizeCiphertext: number;
    fileName: string;
    contentType: string;
}
export type UploadedFileInfo = {
    filekey: string;
    downloadEncryptedQueryParam: string;
    aeskey: string;
    fileSize: number;
    fileSizeCiphertext: number;
};
export declare function uploadMedia(params: {
    client: WeixinApiClient;
    input: InputFile;
    toUserId: string;
    mediaType: number;
    filename?: string;
    contentType?: string;
}): Promise<UploadedMedia>;
export declare function uploadFileToWeixin(params: {
    client: WeixinApiClient;
    input: InputFile;
    toUserId: string;
    filename?: string;
    contentType?: string;
}): Promise<UploadedFileInfo>;
export declare function uploadVideoToWeixin(params: {
    client: WeixinApiClient;
    input: InputFile;
    toUserId: string;
    filename?: string;
    contentType?: string;
}): Promise<UploadedFileInfo>;
export declare function uploadFileAttachmentToWeixin(params: {
    client: WeixinApiClient;
    input: InputFile;
    toUserId: string;
    filename?: string;
    contentType?: string;
}): Promise<UploadedFileInfo>;
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
export declare function sendImageMessageWeixin(params: {
    client: WeixinApiClient;
    to: string;
    text: string;
    uploaded: UploadedFileInfo;
    contextToken: string;
}): Promise<{
    messageId: string;
}>;
export declare function sendVideo(params: {
    client: WeixinApiClient;
    to: string;
    contextToken: string;
    uploaded: UploadedMedia;
    caption?: string;
}): Promise<string>;
export declare function sendVideoMessageWeixin(params: {
    client: WeixinApiClient;
    to: string;
    text: string;
    uploaded: UploadedFileInfo;
    contextToken: string;
}): Promise<{
    messageId: string;
}>;
export declare function sendDocument(params: {
    client: WeixinApiClient;
    to: string;
    contextToken: string;
    uploaded: UploadedMedia;
    caption?: string;
}): Promise<string>;
export declare function sendFileMessageWeixin(params: {
    client: WeixinApiClient;
    to: string;
    text: string;
    fileName: string;
    uploaded: UploadedFileInfo;
    contextToken: string;
}): Promise<{
    messageId: string;
}>;
export declare function downloadMedia(params: {
    client: WeixinApiClient;
    message: WeixinBotMessage;
    options?: DownloadMediaOptions;
}): Promise<DownloadMediaResult>;
export declare function resolveUploadMediaType(contentType: string): number;
