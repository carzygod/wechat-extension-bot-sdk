import { EventEmitter } from "node:events";

import { WeixinAuthManager } from "./auth.js";
import { WeixinApiClient } from "./client.js";
import {
  DEFAULT_BOT_TYPE,
  DEFAULT_LONG_POLL_TIMEOUT_MS,
} from "./constants.js";
import { MissingContextTokenError, SessionExpiredError, WeixinSdkError } from "./errors.js";
import {
  buildTextMessage,
  downloadMedia,
  sendDocument,
  sendImage,
  sendVideo,
  uploadMedia,
} from "./media.js";
import { FileSessionStore, MemorySessionStore } from "./session-store.js";
import {
  MessageItemType,
  TypingStatus,
  UploadMediaType,
} from "./types.js";
import type {
  DownloadMediaOptions,
  DownloadMediaResult,
  InputFile,
  LoginResult,
  LoginSession,
  OnTextListener,
  PollingOptions,
  SendCommonOptions,
  SendMediaOptions,
  SessionStore,
  WaitForLoginOptions,
  WeixinBotMessage,
  WeixinDocument,
  WeixinPhoto,
  WeixinRawMessage,
  WeixinSession,
  WeixinVideo,
  WeixinVoice,
} from "./types.js";
import {
  resolveInputFile,
  resolveSession,
  sleep,
} from "./utils.js";

export interface WeixinBotOptions {
  session?: Partial<WeixinSession> | null;
  sessionStore?: SessionStore | string;
  token?: string;
  accountId?: string;
  baseUrl?: string;
  cdnBaseUrl?: string;
  routeTag?: string;
  polling?: boolean | PollingOptions;
}

type TextListenerRegistration = {
  pattern: RegExp;
  listener: OnTextListener;
};

export class WeixinBot extends EventEmitter {
  private readonly sessionStore: SessionStore;
  private readonly client: WeixinApiClient;
  private readonly auth: WeixinAuthManager;
  private session: WeixinSession | null = null;
  private readonly initialSession: Partial<WeixinSession> | null;
  private sessionLoaded = false;
  private polling = false;
  private pollingOptions: PollingOptions;
  private pollingPromise: Promise<void> | null = null;
  private textListeners: TextListenerRegistration[] = [];
  private typingTicketCache = new Map<string, string>();

  constructor(options: WeixinBotOptions = {}) {
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

  override on(event: "message", listener: (message: WeixinBotMessage) => void | Promise<void>): this;
  override on(event: "text", listener: (message: WeixinBotMessage) => void | Promise<void>): this;
  override on(event: "photo", listener: (message: WeixinBotMessage) => void | Promise<void>): this;
  override on(event: "video", listener: (message: WeixinBotMessage) => void | Promise<void>): this;
  override on(event: "document", listener: (message: WeixinBotMessage) => void | Promise<void>): this;
  override on(event: "voice", listener: (message: WeixinBotMessage) => void | Promise<void>): this;
  override on(event: "login", listener: (session: WeixinSession) => void | Promise<void>): this;
  override on(event: "polling_error", listener: (error: unknown) => void | Promise<void>): this;
  override on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  onText(pattern: RegExp, listener: OnTextListener): this {
    this.textListeners.push({ pattern, listener });
    return this;
  }

  private async ensureSessionLoaded(): Promise<WeixinSession | null> {
    if (this.sessionLoaded) return this.session;

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

  private async saveSession(): Promise<void> {
    if (!this.session) return;
    this.session.updatedAt = new Date().toISOString();
    await this.sessionStore.save(this.session);
  }

  async getSession(): Promise<WeixinSession | null> {
    return this.ensureSessionLoaded();
  }

  async clearSession(): Promise<void> {
    this.session = null;
    this.sessionLoaded = true;
    this.typingTicketCache.clear();
    await this.sessionStore.clear();
    this.client.setSession({
      token: undefined,
      routeTag: undefined,
    });
  }

  async useSession(session: WeixinSession): Promise<void> {
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

  async createLoginSession(options?: { botType?: string; signal?: AbortSignal }): Promise<LoginSession> {
    await this.ensureSessionLoaded();
    return this.auth.createLoginSession({
      botType: options?.botType ?? DEFAULT_BOT_TYPE,
      signal: options?.signal,
    });
  }

  async waitForLogin(sessionKey: string, options?: WaitForLoginOptions): Promise<LoginResult> {
    const result = await this.auth.waitForLogin(sessionKey, options);
    if (result.connected && result.session) {
      await this.useSession(result.session);
      this.emit("login", result.session);
    }
    return result;
  }

  async loginWithQr(options?: WaitForLoginOptions & { botType?: string }): Promise<{ loginSession: LoginSession; result: LoginResult }> {
    const loginSession = await this.createLoginSession({
      botType: options?.botType,
      signal: options?.signal,
    });
    const result = await this.waitForLogin(loginSession.sessionKey, options);
    return { loginSession, result };
  }

  async getLatestContextToken(chatId: string): Promise<string | undefined> {
    const session = await this.ensureSessionLoaded();
    return session?.contextTokens?.[chatId];
  }

  private requireSession(session: WeixinSession | null): WeixinSession {
    if (!session) {
      throw new WeixinSdkError(
        "SESSION_NOT_AVAILABLE",
        "No Weixin session is configured. Call waitForLogin(), useSession(), or provide a stored session first.",
      );
    }
    return session;
  }

  private async resolveContextToken(chatId: string, override?: string): Promise<string> {
    const session = this.requireSession(await this.ensureSessionLoaded());
    const token = override ?? session.contextTokens?.[chatId];
    if (!token) throw new MissingContextTokenError(chatId);
    return token;
  }

  private async rememberContextToken(chatId: string, contextToken?: string): Promise<void> {
    if (!contextToken) return;
    const session = this.requireSession(await this.ensureSessionLoaded());
    session.contextTokens = session.contextTokens ?? {};
    session.contextTokens[chatId] = contextToken;
    await this.saveSession();
  }

  async sendMessage(chatId: string, text: string, options: SendCommonOptions = {}): Promise<{ messageId: string }> {
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

  async sendPhoto(chatId: string, input: InputFile, options: SendMediaOptions = {}): Promise<{ messageId: string }> {
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

  async sendVideo(chatId: string, input: InputFile, options: SendMediaOptions = {}): Promise<{ messageId: string }> {
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

  async sendDocument(chatId: string, input: InputFile, options: SendMediaOptions = {}): Promise<{ messageId: string }> {
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

  async sendTyping(chatId: string, options: SendCommonOptions = {}): Promise<void> {
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
        throw new WeixinSdkError(
          "TYPING_TICKET_UNAVAILABLE",
          `getconfig did not return typing_ticket for chat "${chatId}"`,
        );
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

  async downloadMedia(message: WeixinBotMessage, options?: DownloadMediaOptions): Promise<DownloadMediaResult> {
    await this.ensureSessionLoaded();
    return downloadMedia({
      client: this.client,
      message,
      options,
    });
  }

  private normalizeMessage(raw: WeixinRawMessage): WeixinBotMessage {
    const items = raw.item_list ?? [];
    const textItem = items.find((item) => item.type === MessageItemType.TEXT && item.text_item?.text);
    const imageItem = items.find((item) => item.type === MessageItemType.IMAGE && item.image_item?.media?.encrypt_query_param);
    const videoItem = items.find((item) => item.type === MessageItemType.VIDEO && item.video_item?.media?.encrypt_query_param);
    const fileItem = items.find((item) => item.type === MessageItemType.FILE && item.file_item?.media?.encrypt_query_param);
    const voiceItem = items.find((item) => item.type === MessageItemType.VOICE && item.voice_item?.media?.encrypt_query_param);

    const text = textItem?.text_item?.text ?? voiceItem?.voice_item?.text;
    let type: WeixinBotMessage["type"] = "unknown";
    let media: WeixinBotMessage["media"] | undefined;
    let caption: string | undefined;

    if (imageItem?.image_item?.media?.encrypt_query_param) {
      type = "photo";
      caption = textItem?.text_item?.text;
      media = {
        kind: "photo",
        fileId: imageItem.image_item.media.encrypt_query_param,
        aesKey: imageItem.image_item.media.aes_key,
        item: imageItem.image_item,
      } satisfies WeixinPhoto;
    } else if (videoItem?.video_item?.media?.encrypt_query_param) {
      type = "video";
      caption = textItem?.text_item?.text;
      media = {
        kind: "video",
        fileId: videoItem.video_item.media.encrypt_query_param,
        aesKey: videoItem.video_item.media.aes_key,
        item: videoItem.video_item,
      } satisfies WeixinVideo;
    } else if (fileItem?.file_item?.media?.encrypt_query_param) {
      type = "document";
      caption = textItem?.text_item?.text;
      media = {
        kind: "document",
        fileId: fileItem.file_item.media.encrypt_query_param,
        aesKey: fileItem.file_item.media.aes_key,
        fileName: fileItem.file_item.file_name,
        item: fileItem.file_item,
      } satisfies WeixinDocument;
    } else if (voiceItem?.voice_item?.media?.encrypt_query_param) {
      type = "voice";
      media = {
        kind: "voice",
        fileId: voiceItem.voice_item.media.encrypt_query_param,
        aesKey: voiceItem.voice_item.media.aes_key,
        transcript: voiceItem.voice_item.text,
        item: voiceItem.voice_item,
      } satisfies WeixinVoice;
    } else if (text) {
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

  private async dispatchMessage(message: WeixinBotMessage): Promise<void> {
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

  async startPolling(options?: PollingOptions): Promise<void> {
    if (this.polling) return this.pollingPromise ?? Promise.resolve();
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
            throw new WeixinSdkError(
              "GET_UPDATES_FAILED",
              `getupdates failed: ret=${response.ret ?? ""} errcode=${response.errcode ?? ""} errmsg=${response.errmsg ?? ""}`.trim(),
            );
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
        } catch (error) {
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

  async stopPolling(): Promise<void> {
    this.polling = false;
    if (this.pollingPromise) {
      await this.pollingPromise.catch(() => {});
      this.pollingPromise = null;
    }
  }
}
