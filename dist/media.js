import crypto from "node:crypto";
import fs from "node:fs/promises";
import { MessageItemType, MessageState, MessageType, UploadMediaType } from "./types.js";
import { WeixinSdkError } from "./errors.js";
import { getMimeFromFilename, markdownToPlainText, randomId, resolveInputFile, } from "./utils.js";
export { markdownToPlainText } from "./utils.js";
const CDN_UPLOAD_MAX_RETRIES = 3;
function encryptAesEcb(plaintext, key) {
    const cipher = crypto.createCipheriv("aes-128-ecb", key, null);
    return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}
function decryptAesEcb(ciphertext, key) {
    const decipher = crypto.createDecipheriv("aes-128-ecb", key, null);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
function aesEcbPaddedSize(plaintextSize) {
    return Math.ceil((plaintextSize + 1) / 16) * 16;
}
function buildCdnDownloadUrl(encryptedQueryParam, cdnBaseUrl) {
    return `${cdnBaseUrl}/download?encrypted_query_param=${encodeURIComponent(encryptedQueryParam)}`;
}
function buildCdnUploadUrl(params) {
    return `${params.cdnBaseUrl}/upload?encrypted_query_param=${encodeURIComponent(params.uploadParam)}&filekey=${encodeURIComponent(params.filekey)}`;
}
function parseAesKey(aesKeyBase64) {
    const decoded = Buffer.from(aesKeyBase64, "base64");
    if (decoded.length === 16)
        return decoded;
    if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString("ascii"))) {
        return Buffer.from(decoded.toString("ascii"), "hex");
    }
    throw new WeixinSdkError("INVALID_AES_KEY", `Unsupported CDN aes_key format. Expected 16 raw bytes or 32-char hex string, got ${decoded.length} bytes.`);
}
async function uploadEncryptedBuffer(params) {
    const ciphertext = encryptAesEcb(params.buffer, params.aesKey);
    const uploadFullUrl = params.uploadFullUrl?.trim();
    const cdnUrl = uploadFullUrl
        ? uploadFullUrl
        : params.uploadParam
            ? buildCdnUploadUrl({
                cdnBaseUrl: params.client.cdnBaseUrl,
                uploadParam: params.uploadParam,
                filekey: params.filekey,
            })
            : undefined;
    if (!cdnUrl) {
        throw new WeixinSdkError("CDN_UPLOAD_URL_MISSING", "CDN upload URL missing. Expected getuploadurl to return upload_full_url or upload_param.");
    }
    let lastError;
    for (let attempt = 1; attempt <= CDN_UPLOAD_MAX_RETRIES; attempt += 1) {
        try {
            const response = await fetch(cdnUrl, {
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
        catch (error) {
            lastError = error;
            if (error instanceof WeixinSdkError && error.code === "CDN_UPLOAD_CLIENT_ERROR") {
                throw error;
            }
            if (attempt === CDN_UPLOAD_MAX_RETRIES) {
                break;
            }
        }
    }
    if (lastError instanceof Error)
        throw lastError;
    throw new WeixinSdkError("CDN_UPLOAD_FAILED", "CDN upload failed after retries");
}
export async function uploadMedia(params) {
    const file = await resolveInputFile(params.input, {
        filename: params.filename,
        contentType: params.contentType,
    });
    const filekey = crypto.randomBytes(16).toString("hex");
    const aesKey = crypto.randomBytes(16);
    const rawsize = file.buffer.length;
    const rawfilemd5 = crypto.createHash("md5").update(file.buffer).digest("hex");
    const filesize = aesEcbPaddedSize(rawsize);
    const uploadUrl = await params.client.getUploadUrl({
        filekey,
        media_type: params.mediaType,
        to_user_id: params.toUserId,
        rawsize,
        rawfilemd5,
        filesize,
        no_need_thumb: true,
        aeskey: aesKey.toString("hex"),
    });
    const uploadFullUrl = uploadUrl.upload_full_url?.trim();
    const uploadParam = uploadUrl.upload_param?.trim();
    if (!uploadFullUrl && !uploadParam) {
        throw new WeixinSdkError("UPLOAD_URL_MISSING", "Upstream getuploadurl did not return upload_full_url or upload_param");
    }
    const downloadEncryptedQueryParam = await uploadEncryptedBuffer({
        client: params.client,
        buffer: file.buffer,
        uploadFullUrl,
        uploadParam,
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
export async function uploadFileToWeixin(params) {
    const uploaded = await uploadMedia({
        client: params.client,
        input: params.input,
        toUserId: params.toUserId,
        mediaType: UploadMediaType.IMAGE,
        filename: params.filename,
        contentType: params.contentType,
    });
    return {
        filekey: uploaded.filekey,
        downloadEncryptedQueryParam: uploaded.downloadEncryptedQueryParam,
        aeskey: uploaded.aeskeyHex,
        fileSize: uploaded.fileSize,
        fileSizeCiphertext: uploaded.fileSizeCiphertext,
    };
}
export async function uploadVideoToWeixin(params) {
    const uploaded = await uploadMedia({
        client: params.client,
        input: params.input,
        toUserId: params.toUserId,
        mediaType: UploadMediaType.VIDEO,
        filename: params.filename,
        contentType: params.contentType,
    });
    return {
        filekey: uploaded.filekey,
        downloadEncryptedQueryParam: uploaded.downloadEncryptedQueryParam,
        aeskey: uploaded.aeskeyHex,
        fileSize: uploaded.fileSize,
        fileSizeCiphertext: uploaded.fileSizeCiphertext,
    };
}
export async function uploadFileAttachmentToWeixin(params) {
    const uploaded = await uploadMedia({
        client: params.client,
        input: params.input,
        toUserId: params.toUserId,
        mediaType: UploadMediaType.FILE,
        filename: params.filename,
        contentType: params.contentType,
    });
    return {
        filekey: uploaded.filekey,
        downloadEncryptedQueryParam: uploaded.downloadEncryptedQueryParam,
        aeskey: uploaded.aeskeyHex,
        fileSize: uploaded.fileSize,
        fileSizeCiphertext: uploaded.fileSizeCiphertext,
    };
}
export function buildTextMessage(params) {
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
async function sendItems(params) {
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
export async function sendImage(params) {
    const items = [];
    if (params.caption) {
        items.push({ type: MessageItemType.TEXT, text_item: { text: markdownToPlainText(params.caption) } });
    }
    items.push({
        type: MessageItemType.IMAGE,
        image_item: {
            media: {
                encrypt_query_param: params.uploaded.downloadEncryptedQueryParam,
                aes_key: Buffer.from(params.uploaded.aeskeyHex).toString("base64"),
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
export async function sendImageMessageWeixin(params) {
    const messageId = await sendImage({
        client: params.client,
        to: params.to,
        contextToken: params.contextToken,
        caption: params.text,
        uploaded: {
            filekey: params.uploaded.filekey,
            downloadEncryptedQueryParam: params.uploaded.downloadEncryptedQueryParam,
            aeskeyHex: params.uploaded.aeskey,
            fileSize: params.uploaded.fileSize,
            fileSizeCiphertext: params.uploaded.fileSizeCiphertext,
            fileName: "image",
            contentType: "image/*",
        },
    });
    return { messageId };
}
export async function sendVideo(params) {
    const items = [];
    if (params.caption) {
        items.push({ type: MessageItemType.TEXT, text_item: { text: markdownToPlainText(params.caption) } });
    }
    items.push({
        type: MessageItemType.VIDEO,
        video_item: {
            media: {
                encrypt_query_param: params.uploaded.downloadEncryptedQueryParam,
                aes_key: Buffer.from(params.uploaded.aeskeyHex).toString("base64"),
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
export async function sendVideoMessageWeixin(params) {
    const messageId = await sendVideo({
        client: params.client,
        to: params.to,
        contextToken: params.contextToken,
        caption: params.text,
        uploaded: {
            filekey: params.uploaded.filekey,
            downloadEncryptedQueryParam: params.uploaded.downloadEncryptedQueryParam,
            aeskeyHex: params.uploaded.aeskey,
            fileSize: params.uploaded.fileSize,
            fileSizeCiphertext: params.uploaded.fileSizeCiphertext,
            fileName: "video.mp4",
            contentType: "video/mp4",
        },
    });
    return { messageId };
}
export async function sendDocument(params) {
    const items = [];
    if (params.caption) {
        items.push({ type: MessageItemType.TEXT, text_item: { text: markdownToPlainText(params.caption) } });
    }
    items.push({
        type: MessageItemType.FILE,
        file_item: {
            media: {
                encrypt_query_param: params.uploaded.downloadEncryptedQueryParam,
                aes_key: Buffer.from(params.uploaded.aeskeyHex).toString("base64"),
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
export async function sendFileMessageWeixin(params) {
    const messageId = await sendDocument({
        client: params.client,
        to: params.to,
        contextToken: params.contextToken,
        caption: params.text,
        uploaded: {
            filekey: params.uploaded.filekey,
            downloadEncryptedQueryParam: params.uploaded.downloadEncryptedQueryParam,
            aeskeyHex: params.uploaded.aeskey,
            fileSize: params.uploaded.fileSize,
            fileSizeCiphertext: params.uploaded.fileSizeCiphertext,
            fileName: params.fileName,
            contentType: getMimeFromFilename(params.fileName),
        },
    });
    return { messageId };
}
function getDownloadTarget(message) {
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
                fullUrl: message.media.item.media?.full_url,
                fileName: "image.jpg",
                mimeType: "image/jpeg",
            };
        case "video":
            return {
                fileId: message.media.fileId,
                aesKey: message.media.aesKey,
                fullUrl: message.media.item.media?.full_url,
                fileName: "video.mp4",
                mimeType: "video/mp4",
            };
        case "document":
            return {
                fileId: message.media.fileId,
                aesKey: message.media.aesKey,
                fullUrl: message.media.item.media?.full_url,
                fileName: message.media.fileName ?? "file.bin",
                mimeType: getMimeFromFilename(message.media.fileName ?? "file.bin"),
            };
        case "voice":
            return {
                fileId: message.media.fileId,
                aesKey: message.media.aesKey,
                fullUrl: message.media.item.media?.full_url,
                fileName: "voice.silk",
                mimeType: "audio/silk",
            };
    }
}
export async function downloadMedia(params) {
    const target = getDownloadTarget(params.message);
    const response = await fetch(target.fullUrl ?? buildCdnDownloadUrl(target.fileId, params.client.cdnBaseUrl));
    if (!response.ok) {
        throw new WeixinSdkError("CDN_DOWNLOAD_FAILED", `CDN download failed: ${response.status} ${response.statusText}`);
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
export function resolveUploadMediaType(contentType) {
    if (contentType.startsWith("image/"))
        return UploadMediaType.IMAGE;
    if (contentType.startsWith("video/"))
        return UploadMediaType.VIDEO;
    return UploadMediaType.FILE;
}
//# sourceMappingURL=media.js.map