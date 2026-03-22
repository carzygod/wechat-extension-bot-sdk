import type { BaseInfo, InputFile, WeixinSession } from "./types.js";
export declare function buildBaseInfo(): BaseInfo;
export declare function ensureTrailingSlash(url: string): string;
export declare function randomWechatUin(): string;
export declare function randomId(prefix: string): string;
export declare function sleep(ms: number, signal?: AbortSignal): Promise<void>;
export declare function withTimeout(timeoutMs: number, signal?: AbortSignal): {
    signal: AbortSignal;
    cancel: () => void;
};
export declare function isHttpUrl(input: string): boolean;
export declare function isFileUrl(input: string): boolean;
export declare function sanitizeFileName(fileName: string): string;
export declare function resolveSession(partial?: Partial<WeixinSession> | null): WeixinSession | null;
export declare function getMimeFromFilename(filename: string): string;
export declare function getExtensionFromMime(mimeType: string): string;
export declare function getExtensionFromContentTypeOrUrl(contentType: string | null, rawUrl: string): string;
export type ResolvedInputFile = {
    buffer: Buffer;
    fileName: string;
    contentType: string;
};
export declare function resolveInputFile(input: InputFile, options?: {
    filename?: string;
    contentType?: string;
}): Promise<ResolvedInputFile>;
export declare function resolveApiTimeout(timeoutMs?: number): number;
export declare function resolveLightApiTimeout(timeoutMs?: number): number;
export declare function markdownToPlainText(text: string): string;
