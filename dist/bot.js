import { EventEmitter } from "node:events";
import { WeixinAuthManager } from "./auth.js";
import { WeixinApiClient } from "./client.js";
import { DEFAULT_BOT_TYPE, DEFAULT_LONG_POLL_TIMEOUT_MS, } from "./constants.js";
import { MissingContextTokenError, SessionExpiredError, WeixinSdkError } from "./errors.js";
import { buildTextMessage, downloadMedia, sendDocument, sendImage, sendVideo, uploadMedia, } from "./media.js";
import { FileSessionStore, MemorySessionStore } from "./session-store.js";
import { MessageItemType, TypingStatus, UploadMediaType, } from "./types.js";
import { resolveInputFile, resolveSession, sleep, } from "./utils.js";
export class WeixinBot extends EventEmitter {
    sessionStore;
    client;
    auth;
    session = null;
    initialSession;
    sessionLoaded = false;
    polling = false;
    pollingOptions;
    pollingPromise = null;
    textListeners = [];
    typingTicketCache = new Map();
    constructor(options = {}) {
        super();
        this.initialSession = options.session ?? (options.token && options.accountId
            ? {
                token: options.token,
                accountId: options.accountId,
                baseUrl: options.baseUrl,
                cdnBaseUrl: options.cdnBaseUrl,
                routeTag: options.routeTag,
                contextTokens: {},
            }
            : null);
        this.sessionStore =
            typeof options.sessionStore === "string"
                ? new FileSessionStore(options.sessionStore)
                : options.sessionStore ?? new MemorySessionStore();
        this.client = new WeixinApiClient({
            baseUrl: options.baseUrl,
            cdnBaseUrl: options.cdnBaseUrl,
            routeTag: options.routeTag,
            token: options.token,
        });
        this.auth = new WeixinAuthManager(this.client);
        this.pollingOptions =
            typeof options.polling === "object" ? options.polling : { timeoutMs: DEFAULT_LONG_POLL_TIMEOUT_MS };
        if (options.polling) {
            queueMicrotask(() => {
                void this.startPolling().catch((error) => this.emit("polling_error", error));
            });
        }
    }
    on(event, listener) {
        return super.on(event, listener);
    }
    onText(pattern, listener) {
        this.textListeners.push({ pattern, listener });
        return this;
    }
    async ensureSessionLoaded() {
        if (this.sessionLoaded)
            return this.session;
        const stored = resolveSession(await this.sessionStore.load());
        const initial = resolveSession(this.initialSession);
        this.session = stored ?? initial;
        this.sessionLoaded = true;
        if (this.session) {
            this.client.setSession({
                token: this.session.token,
                baseUrl: this.session.baseUrl,
                cdnBaseUrl: this.session.cdnBaseUrl,
                routeTag: this.session.routeTag,
            });
        }
        return this.session;
    }
    async saveSession() {
        if (!this.session)
            return;
        this.session.updatedAt = new Date().toISOString();
        await this.sessionStore.save(this.session);
    }
    async getSession() {
        return this.ensureSessionLoaded();
    }
    async clearSession() {
        this.session = null;
        this.sessionLoaded = true;
        this.typingTicketCache.clear();
        await this.sessionStore.clear();
        this.client.setSession({
            token: undefined,
            routeTag: undefined,
        });
    }
    async useSession(session) {
        this.session = {
            ...session,
            syncBuffer: session.syncBuffer ?? "",
            contextTokens: { ...(session.contextTokens ?? {}) },
            updatedAt: new Date().toISOString(),
            createdAt: session.createdAt ?? new Date().toISOString(),
        };
        this.sessionLoaded = true;
        this.client.setSession({
            token: session.token,
            baseUrl: session.baseUrl,
            cdnBaseUrl: session.cdnBaseUrl,
            routeTag: session.routeTag,
        });
        await this.saveSession();
    }
    async createLoginSession(options) {
        await this.ensureSessionLoaded();
        return this.auth.createLoginSession({
            botType: options?.botType ?? DEFAULT_BOT_TYPE,
            signal: options?.signal,
        });
    }
    async waitForLogin(sessionKey, options) {
        const result = await this.auth.waitForLogin(sessionKey, options);
        if (result.connected && result.session) {
            await this.useSession(result.session);
            this.emit("login", result.session);
        }
        return result;
    }
    async loginWithQr(options) {
        const loginSession = await this.createLoginSession({
            botType: options?.botType,
            signal: options?.signal,
        });
        const result = await this.waitForLogin(loginSession.sessionKey, options);
        return { loginSession, result };
    }
    async getLatestContextToken(chatId) {
        const session = await this.ensureSessionLoaded();
        return session?.contextTokens?.[chatId];
    }
    requireSession(session) {
        if (!session) {
            throw new WeixinSdkError("SESSION_NOT_AVAILABLE", "No Weixin session is configured. Call waitForLogin(), useSession(), or provide a stored session first.");
        }
        return session;
    }
    async resolveContextToken(chatId, override) {
        const session = this.requireSession(await this.ensureSessionLoaded());
        const token = override ?? session.contextTokens?.[chatId];
        if (!token)
            throw new MissingContextTokenError(chatId);
        return token;
    }
    async rememberContextToken(chatId, contextToken) {
        if (!contextToken)
            return;
        const session = this.requireSession(await this.ensureSessionLoaded());
        session.contextTokens = session.contextTokens ?? {};
        session.contextTokens[chatId] = contextToken;
        await this.saveSession();
    }
    async sendMessage(chatId, text, options = {}) {
        await this.ensureSessionLoaded();
        const contextToken = await this.resolveContextToken(chatId, options.contextToken);
        const payload = buildTextMessage({
            to: chatId,
            text,
            contextToken,
        });
        const clientId = payload.msg?.client_id ?? "";
        await this.client.sendMessage(payload);
        return { messageId: clientId };
    }
    async sendPhoto(chatId, input, options = {}) {
        await this.ensureSessionLoaded();
        const contextToken = await this.resolveContextToken(chatId, options.contextToken);
        const uploaded = await uploadMedia({
            client: this.client,
            input,
            toUserId: chatId,
            mediaType: UploadMediaType.IMAGE,
            filename: options.filename,
            contentType: options.contentType,
        });
        const messageId = await sendImage({
            client: this.client,
            to: chatId,
            contextToken,
            uploaded,
            caption: options.caption,
        });
        return { messageId };
    }
    async sendVideo(chatId, input, options = {}) {
        await this.ensureSessionLoaded();
        const contextToken = await this.resolveContextToken(chatId, options.contextToken);
        const uploaded = await uploadMedia({
            client: this.client,
            input,
            toUserId: chatId,
            mediaType: UploadMediaType.VIDEO,
            filename: options.filename,
            contentType: options.contentType,
        });
        const messageId = await sendVideo({
            client: this.client,
            to: chatId,
            contextToken,
            uploaded,
            caption: options.caption,
        });
        return { messageId };
    }
    async sendDocument(chatId, input, options = {}) {
        await this.ensureSessionLoaded();
        const contextToken = await this.resolveContextToken(chatId, options.contextToken);
        const file = await resolveInputFile(input, {
            filename: options.filename,
            contentType: options.contentType,
        });
        const uploaded = await uploadMedia({
            client: this.client,
            input: { source: file.buffer, filename: file.fileName, contentType: file.contentType },
            toUserId: chatId,
            mediaType: UploadMediaType.FILE,
            filename: file.fileName,
            contentType: file.contentType,
        });
        const messageId = await sendDocument({
            client: this.client,
            to: chatId,
            contextToken,
            uploaded,
            caption: options.caption,
        });
        return { messageId };
    }
    async sendTyping(chatId, options = {}) {
        await this.ensureSessionLoaded();
        const session = this.requireSession(this.session);
        const contextToken = await this.resolveContextToken(chatId, options.contextToken);
        let typingTicket = this.typingTicketCache.get(chatId);
        if (!typingTicket) {
            const config = await this.client.getConfig({
                ilinkUserId: chatId,
                contextToken,
            });
            if ((config.ret ?? 0) !== 0 || !config.typing_ticket) {
                throw new WeixinSdkError("TYPING_TICKET_UNAVAILABLE", `getconfig did not return typing_ticket for chat "${chatId}"`);
            }
            typingTicket = config.typing_ticket;
            this.typingTicketCache.set(chatId, typingTicket);
        }
        await this.client.sendTyping({
            ilink_user_id: chatId,
            typing_ticket: typingTicket,
            status: TypingStatus.TYPING,
        });
        session.updatedAt = new Date().toISOString();
        await this.saveSession();
    }
    async downloadMedia(message, options) {
        await this.ensureSessionLoaded();
        return downloadMedia({
            client: this.client,
            message,
            options,
        });
    }
    normalizeMessage(raw) {
        const items = raw.item_list ?? [];
        const textItem = items.find((item) => item.type === MessageItemType.TEXT && item.text_item?.text);
        const imageItem = items.find((item) => item.type === MessageItemType.IMAGE && item.image_item?.media?.encrypt_query_param);
        const videoItem = items.find((item) => item.type === MessageItemType.VIDEO && item.video_item?.media?.encrypt_query_param);
        const fileItem = items.find((item) => item.type === MessageItemType.FILE && item.file_item?.media?.encrypt_query_param);
        const voiceItem = items.find((item) => item.type === MessageItemType.VOICE && item.voice_item?.media?.encrypt_query_param);
        const text = textItem?.text_item?.text ?? voiceItem?.voice_item?.text;
        let type = "unknown";
        let media;
        let caption;
        if (imageItem?.image_item?.media?.encrypt_query_param) {
            type = "photo";
            caption = textItem?.text_item?.text;
            media = {
                kind: "photo",
                fileId: imageItem.image_item.media.encrypt_query_param,
                aesKey: imageItem.image_item.media.aes_key,
                item: imageItem.image_item,
            };
        }
        else if (videoItem?.video_item?.media?.encrypt_query_param) {
            type = "video";
            caption = textItem?.text_item?.text;
            media = {
                kind: "video",
                fileId: videoItem.video_item.media.encrypt_query_param,
                aesKey: videoItem.video_item.media.aes_key,
                item: videoItem.video_item,
            };
        }
        else if (fileItem?.file_item?.media?.encrypt_query_param) {
            type = "document";
            caption = textItem?.text_item?.text;
            media = {
                kind: "document",
                fileId: fileItem.file_item.media.encrypt_query_param,
                aesKey: fileItem.file_item.media.aes_key,
                fileName: fileItem.file_item.file_name,
                item: fileItem.file_item,
            };
        }
        else if (voiceItem?.voice_item?.media?.encrypt_query_param) {
            type = "voice";
            media = {
                kind: "voice",
                fileId: voiceItem.voice_item.media.encrypt_query_param,
                aesKey: voiceItem.voice_item.media.aes_key,
                transcript: voiceItem.voice_item.text,
                item: voiceItem.voice_item,
            };
        }
        else if (text) {
            type = "text";
        }
        const fromId = raw.from_user_id ?? "";
        return {
            id: raw.message_id,
            seq: raw.seq,
            type,
            chat: { id: fromId, type: "private" },
            from: { id: fromId },
            date: raw.create_time_ms,
            text,
            caption,
            contextToken: raw.context_token,
            media,
            raw,
        };
    }
    async dispatchMessage(message) {
        await this.rememberContextToken(message.chat.id, message.contextToken);
        this.emit("message", message);
        if (message.type !== "unknown") {
            this.emit(message.type, message);
        }
        if (message.text) {
            for (const registration of this.textListeners) {
                const match = registration.pattern.exec(message.text);
                registration.pattern.lastIndex = 0;
                if (match) {
                    await registration.listener(message, match);
                }
            }
        }
    }
    async startPolling(options) {
        if (this.polling)
            return this.pollingPromise ?? Promise.resolve();
        await this.ensureSessionLoaded();
        const session = this.requireSession(this.session);
        this.polling = true;
        const pollingOptions = { ...this.pollingOptions, ...options };
        this.pollingPromise = (async () => {
            let nextTimeoutMs = pollingOptions.timeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS;
            while (this.polling) {
                try {
                    const response = await this.client.getUpdates({
                        getUpdatesBuf: session.syncBuffer ?? "",
                        timeoutMs: nextTimeoutMs,
                    });
                    if ((response.errcode ?? response.ret ?? 0) === -14) {
                        throw new SessionExpiredError(response.errmsg ?? "Weixin session expired");
                    }
                    if ((response.errcode ?? 0) !== 0 || (response.ret ?? 0) !== 0) {
                        throw new WeixinSdkError("GET_UPDATES_FAILED", `getupdates failed: ret=${response.ret ?? ""} errcode=${response.errcode ?? ""} errmsg=${response.errmsg ?? ""}`.trim());
                    }
                    if (response.longpolling_timeout_ms && response.longpolling_timeout_ms > 0) {
                        nextTimeoutMs = response.longpolling_timeout_ms;
                    }
                    if (typeof response.get_updates_buf === "string") {
                        session.syncBuffer = response.get_updates_buf;
                        await this.saveSession();
                    }
                    for (const raw of response.msgs ?? []) {
                        const message = this.normalizeMessage(raw);
                        await this.dispatchMessage(message);
                    }
                }
                catch (error) {
                    this.emit("polling_error", error);
                    if (error instanceof SessionExpiredError) {
                        this.polling = false;
                        throw error;
                    }
                    await sleep(pollingOptions.retryDelayMs ?? 2_000);
                }
            }
        })();
        return this.pollingPromise;
    }
    async stopPolling() {
        this.polling = false;
        if (this.pollingPromise) {
            await this.pollingPromise.catch(() => { });
            this.pollingPromise = null;
        }
    }
}
//# sourceMappingURL=bot.js.map