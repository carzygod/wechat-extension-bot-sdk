import crypto from "node:crypto";
import path from "node:path";

import {
  DEFAULT_API_TIMEOUT_MS,
  DEFAULT_CDN_BASE_URL,
  DEFAULT_LIGHT_API_TIMEOUT_MS,
  SDK_NAME,
  SDK_VERSION,
} from "./constants.js";
import type { BaseInfo, InputFile, WeixinSession } from "./types.js";

export function buildBaseInfo(): BaseInfo {
  return { channel_version: `${SDK_NAME}@${SDK_VERSION}` };
}

export function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

export function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf-8").toString("base64");
}

export function randomId(prefix: string): string {
  return `${prefix}:${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (!signal) return;
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
      },
      { once: true },
    );
  });
}

export function withTimeout(
  timeoutMs: number,
  signal?: AbortSignal,
): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);

  if (signal) {
    signal.addEventListener(
      "abort",
      () => controller.abort(signal.reason instanceof Error ? signal.reason : new Error("aborted")),
      { once: true },
    );
  }

  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  };
}

export function isHttpUrl(input: string): boolean {
  return input.startsWith("http://") || input.startsWith("https://");
}

export function isFileUrl(input: string): boolean {
  return input.startsWith("file://");
}

export function sanitizeFileName(fileName: string): string {
  const cleaned = fileName.replace(/[\\/:*?"<>|]/g, "_").trim();
  return cleaned || "file.bin";
}

export function resolveSession(
  partial?: Partial<WeixinSession> | null,
): WeixinSession | null {
  if (!partial?.token || !partial.accountId) return null;

  return {
    token: partial.token,
    accountId: partial.accountId,
    userId: partial.userId,
    baseUrl: partial.baseUrl?.trim() || "",
    cdnBaseUrl: partial.cdnBaseUrl?.trim() || DEFAULT_CDN_BASE_URL,
    routeTag: partial.routeTag,
    syncBuffer: partial.syncBuffer ?? "",
    contextTokens: { ...(partial.contextTokens ?? {}) },
    createdAt: partial.createdAt,
    updatedAt: partial.updatedAt,
  };
}

const EXTENSION_TO_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".zip": "application/zip",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

const MIME_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "video/x-matroska": ".mkv",
  "video/x-msvideo": ".avi",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
  "application/pdf": ".pdf",
  "application/zip": ".zip",
  "application/x-tar": ".tar",
  "application/gzip": ".gz",
  "text/plain": ".txt",
  "text/csv": ".csv",
};

export function getMimeFromFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return EXTENSION_TO_MIME[ext] ?? "application/octet-stream";
}

export function getExtensionFromMime(mimeType: string): string {
  const ct = mimeType.split(";")[0].trim().toLowerCase();
  return MIME_TO_EXTENSION[ct] ?? ".bin";
}

export function getExtensionFromContentTypeOrUrl(contentType: string | null, rawUrl: string): string {
  if (contentType) {
    const ext = getExtensionFromMime(contentType);
    if (ext !== ".bin") return ext;
  }
  try {
    const ext = path.extname(new URL(rawUrl).pathname).toLowerCase();
    return EXTENSION_TO_MIME[ext] ? ext : ".bin";
  } catch {
    return ".bin";
  }
}

export type ResolvedInputFile = {
  buffer: Buffer;
  fileName: string;
  contentType: string;
};

export async function resolveInputFile(
  input: InputFile,
  options?: { filename?: string; contentType?: string },
): Promise<ResolvedInputFile> {
  if (typeof input === "string") {
    if (isHttpUrl(input)) {
      const response = await fetch(input);
      if (!response.ok) {
        throw new Error(`remote file download failed: ${response.status} ${response.statusText}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const ext = getExtensionFromContentTypeOrUrl(response.headers.get("content-type"), input);
      const fileName = sanitizeFileName(options?.filename ?? `remote${ext}`);
      return {
        buffer,
        fileName,
        contentType: options?.contentType ?? getMimeFromFilename(fileName),
      };
    }

    const filePath = isFileUrl(input) ? new URL(input) : input;
    const { readFile } = await import("node:fs/promises");
    const resolvedBuffer = Buffer.from(await readFile(filePath));
    const fileName = sanitizeFileName(options?.filename ?? path.basename(String(filePath)));
    return {
      buffer: resolvedBuffer,
      fileName,
      contentType: options?.contentType ?? getMimeFromFilename(fileName),
    };
  }

  if (input instanceof URL) {
    return resolveInputFile(input.toString(), options);
  }

  if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
    const fileName = sanitizeFileName(
      options?.filename ?? `buffer${getExtensionFromMime(options?.contentType ?? "application/octet-stream")}`,
    );
    return {
      buffer: Buffer.from(input),
      fileName,
      contentType: options?.contentType ?? getMimeFromFilename(fileName),
    };
  }

  const fileName = sanitizeFileName(
    input.filename ??
      options?.filename ??
      `buffer${getExtensionFromMime(input.contentType ?? options?.contentType ?? "application/octet-stream")}`,
  );

  return {
    buffer: Buffer.from(input.source),
    fileName,
    contentType: input.contentType ?? options?.contentType ?? getMimeFromFilename(fileName),
  };
}

export function resolveApiTimeout(timeoutMs?: number): number {
  return timeoutMs ?? DEFAULT_API_TIMEOUT_MS;
}

export function resolveLightApiTimeout(timeoutMs?: number): number {
  return timeoutMs ?? DEFAULT_LIGHT_API_TIMEOUT_MS;
}

export function markdownToPlainText(text: string): string {
  let result = text;
  result = result.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_whole, code: string) => code.trim());
  result = result.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  result = result.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  result = result.replace(/^\|[\s:|-]+\|$/gm, "");
  result = result.replace(/^\|(.+)\|$/gm, (_whole, inner: string) =>
    inner.split("|").map((cell) => cell.trim()).join("  "),
  );
  result = result.replace(/^[>\-*`#]+\s?/gm, "");
  result = result.replace(/[*_~`]/g, "");
  return result.trim();
}
