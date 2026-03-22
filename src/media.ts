import crypto from "node:crypto";
import fs from "node:fs/promises";

import { MessageItemType, MessageState, MessageType, UploadMediaType } from "./types.js";
import type {
  DownloadMediaOptions,
  DownloadMediaResult,
  GetUploadUrlResp,
  InputFile,
  MessageItem,
  SendMessageReq,
  WeixinBotMessage,
} from "./types.js";
import { WeixinSdkError } from "./errors.js";
import { WeixinApiClient } from "./client.js";
import {
  getMimeFromFilename,
  markdownToPlainText,
  randomId,
  resolveInputFile,
} from "./utils.js";

export interface UploadedMedia {
  filekey: string;
  downloadEncryptedQueryParam: string;
  aeskeyHex: string;
  fileSize: number;
  fileSizeCiphertext: number;
  fileName: string;
  contentType: string;
}

function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = crypto.createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

function decryptAesEcb(ciphertext: Buffer, key: Buffer): Buffer {
  const decipher = crypto.createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function aesEcbPaddedSize(plaintextSize: number): number {
  return Math.ceil((plaintextSize + 1) / 16) * 16;
}

function buildCdnDownloadUrl(encryptedQueryParam: string, cdnBaseUrl: string): string {
  return `${cdnBaseUrl}/download?encrypted_query_param=${encodeURIComponent(encryptedQueryParam)}`;
}

function buildCdnUploadUrl(params: {
  cdnBaseUrl: string;
  uploadParam: string;
  filekey: string;
}): string {
  return `${params.cdnBaseUrl}/upload?encrypted_query_param=${encodeURIComponent(params.uploadParam)}&filekey=${encodeURIComponent(params.filekey)}`;
}

function parseAesKey(aesKeyBase64: string): Buffer {
  const decoded = Buffer.from(aesKeyBase64, "base64");
  if (decoded.length === 16) return decoded;
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString("ascii"))) {
    return Buffer.from(decoded.toString("ascii"), "hex");
  }
  throw new WeixinSdkError(
    "INVALID_AES_KEY",
    `Unsupported CDN aes_key format. Expected 16 raw bytes or 32-char hex string, got ${decoded.length} bytes.`,
  );
}

async function uploadEncryptedBuffer(params: {
  client: WeixinApiClient;
  buffer: Buffer;
  uploadParam: string;
  filekey: string;
  aesKey: Buffer;
}): Promise<string> {
  const ciphertext = encryptAesEcb(params.buffer, params.aesKey);
  const response = await fetch(buildCdnUploadUrl({
    cdnBaseUrl: params.client.cdnBaseUrl,
    uploadParam: params.uploadParam,
    filekey: params.filekey,
  }), {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: new Uint8Array(ciphertext),
  });

  if (response.status >= 400 && response.status < 500) {
    const message = response.headers.get("x-error-message") ?? (await response.text());
    throw new WeixinSdkError("CDN_UPLOAD_CLIENT_ERROR", `CDN upload failed: ${message}`);
  }

  if (response.status !== 200) {
    const message = response.headers.get("x-error-message") ?? `status ${response.status}`;
    throw new WeixinSdkError("CDN_UPLOAD_SERVER_ERROR", `CDN upload failed: ${message}`);
  }

  const encryptedParam = response.headers.get("x-encrypted-param");
  if (!encryptedParam) {
    throw new WeixinSdkError("CDN_UPLOAD_MISSING_PARAM", "CDN upload response missing x-encrypted-param");
  }

  return encryptedParam;
}

export async function uploadMedia(params: {
  client: WeixinApiClient;
  input: InputFile;
  toUserId: string;
  mediaType: number;
  filename?: string;
  contentType?: string;
}): Promise<UploadedMedia> {
  const file = await resolveInputFile(params.input, {
    filename: params.filename,
    contentType: params.contentType,
  });
  const filekey = crypto.randomBytes(16).toString("hex");
  const aesKey = crypto.randomBytes(16);
  const rawsize = file.buffer.length;
  const rawfilemd5 = crypto.createHash("md5").update(file.buffer).digest("hex");
  const filesize = aesEcbPaddedSize(rawsize);

  const uploadUrl: GetUploadUrlResp = await params.client.getUploadUrl({
    filekey,
    media_type: params.mediaType,
    to_user_id: params.toUserId,
    rawsize,
    rawfilemd5,
    filesize,
    no_need_thumb: true,
    aeskey: aesKey.toString("hex"),
  });

  if (!uploadUrl.upload_param) {
    throw new WeixinSdkError("UPLOAD_URL_MISSING", "Upstream getuploadurl did not return upload_param");
  }

  const downloadEncryptedQueryParam = await uploadEncryptedBuffer({
    client: params.client,
    buffer: file.buffer,
    uploadParam: uploadUrl.upload_param,
    filekey,
    aesKey,
  });

  return {
    filekey,
    downloadEncryptedQueryParam,
    aeskeyHex: aesKey.toString("hex"),
    fileSize: file.buffer.length,
    fileSizeCiphertext: filesize,
    fileName: file.fileName,
    contentType: file.contentType,
  };
}

export function buildTextMessage(params: {
  to: string;
  text: string;
  contextToken: string;
}): SendMessageReq {
  const cleaned = markdownToPlainText(params.text);
  return {
    msg: {
      from_user_id: "",
      to_user_id: params.to,
      client_id: randomId("weixin"),
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      item_list: cleaned
        ? [{ type: MessageItemType.TEXT, text_item: { text: cleaned } }]
        : undefined,
      context_token: params.contextToken,
    },
  };
}

async function sendItems(params: {
  client: WeixinApiClient;
  to: string;
  contextToken: string;
  items: MessageItem[];
}): Promise<string> {
  let lastClientId = "";
  for (const item of params.items) {
    lastClientId = randomId("weixin");
    await params.client.sendMessage({
      msg: {
        from_user_id: "",
        to_user_id: params.to,
        client_id: lastClientId,
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        item_list: [item],
        context_token: params.contextToken,
      },
    });
  }
  return lastClientId;
}

export async function sendImage(params: {
  client: WeixinApiClient;
  to: string;
  contextToken: string;
  uploaded: UploadedMedia;
  caption?: string;
}): Promise<string> {
  const items: MessageItem[] = [];
  if (params.caption) {
    items.push({ type: MessageItemType.TEXT, text_item: { text: markdownToPlainText(params.caption) } });
  }
  items.push({
    type: MessageItemType.IMAGE,
    image_item: {
      media: {
        encrypt_query_param: params.uploaded.downloadEncryptedQueryParam,
        aes_key: Buffer.from(params.uploaded.aeskeyHex, "hex").toString("base64"),
        encrypt_type: 1,
      },
      mid_size: params.uploaded.fileSizeCiphertext,
    },
  });

  return sendItems({
    client: params.client,
    to: params.to,
    contextToken: params.contextToken,
    items,
  });
}

export async function sendVideo(params: {
  client: WeixinApiClient;
  to: string;
  contextToken: string;
  uploaded: UploadedMedia;
  caption?: string;
}): Promise<string> {
  const items: MessageItem[] = [];
  if (params.caption) {
    items.push({ type: MessageItemType.TEXT, text_item: { text: markdownToPlainText(params.caption) } });
  }
  items.push({
    type: MessageItemType.VIDEO,
    video_item: {
      media: {
        encrypt_query_param: params.uploaded.downloadEncryptedQueryParam,
        aes_key: Buffer.from(params.uploaded.aeskeyHex, "hex").toString("base64"),
        encrypt_type: 1,
      },
      video_size: params.uploaded.fileSizeCiphertext,
    },
  });

  return sendItems({
    client: params.client,
    to: params.to,
    contextToken: params.contextToken,
    items,
  });
}

export async function sendDocument(params: {
  client: WeixinApiClient;
  to: string;
  contextToken: string;
  uploaded: UploadedMedia;
  caption?: string;
}): Promise<string> {
  const items: MessageItem[] = [];
  if (params.caption) {
    items.push({ type: MessageItemType.TEXT, text_item: { text: markdownToPlainText(params.caption) } });
  }
  items.push({
    type: MessageItemType.FILE,
    file_item: {
      media: {
        encrypt_query_param: params.uploaded.downloadEncryptedQueryParam,
        aes_key: Buffer.from(params.uploaded.aeskeyHex, "hex").toString("base64"),
        encrypt_type: 1,
      },
      file_name: params.uploaded.fileName,
      len: String(params.uploaded.fileSize),
    },
  });

  return sendItems({
    client: params.client,
    to: params.to,
    contextToken: params.contextToken,
    items,
  });
}

function getDownloadTarget(message: WeixinBotMessage) {
  if (!message.media) {
    throw new WeixinSdkError("NO_MEDIA", "Message does not contain downloadable media");
  }

  switch (message.media.kind) {
    case "photo":
      return {
        fileId: message.media.fileId,
        aesKey: message.media.item.aeskey
          ? Buffer.from(message.media.item.aeskey, "hex").toString("base64")
          : message.media.aesKey,
        fileName: "image.jpg",
        mimeType: "image/jpeg",
      };
    case "video":
      return {
        fileId: message.media.fileId,
        aesKey: message.media.aesKey,
        fileName: "video.mp4",
        mimeType: "video/mp4",
      };
    case "document":
      return {
        fileId: message.media.fileId,
        aesKey: message.media.aesKey,
        fileName: message.media.fileName ?? "file.bin",
        mimeType: getMimeFromFilename(message.media.fileName ?? "file.bin"),
      };
    case "voice":
      return {
        fileId: message.media.fileId,
        aesKey: message.media.aesKey,
        fileName: "voice.silk",
        mimeType: "audio/silk",
      };
  }
}

export async function downloadMedia(params: {
  client: WeixinApiClient;
  message: WeixinBotMessage;
  options?: DownloadMediaOptions;
}): Promise<DownloadMediaResult> {
  const target = getDownloadTarget(params.message);
  const response = await fetch(buildCdnDownloadUrl(target.fileId, params.client.cdnBaseUrl));
  if (!response.ok) {
    throw new WeixinSdkError(
      "CDN_DOWNLOAD_FAILED",
      `CDN download failed: ${response.status} ${response.statusText}`,
    );
  }

  const encrypted = Buffer.from(await response.arrayBuffer());
  const buffer = target.aesKey ? decryptAesEcb(encrypted, parseAesKey(target.aesKey)) : encrypted;

  if (params.options?.filePath) {
    await fs.writeFile(params.options.filePath, buffer);
  }

  return {
    buffer,
    fileName: target.fileName,
    mimeType: target.mimeType,
  };
}

export function resolveUploadMediaType(contentType: string): number {
  if (contentType.startsWith("image/")) return UploadMediaType.IMAGE;
  if (contentType.startsWith("video/")) return UploadMediaType.VIDEO;
  return UploadMediaType.FILE;
}
