import { EventEmitter } from "node:events";
import type { DownloadMediaOptions, DownloadMediaResult, InputFile, LoginResult, LoginSession, OnTextListener, PollingOptions, SendCommonOptions, SendMediaOptions, SessionStore, WaitForLoginOptions, WeixinBotMessage, WeixinSession } from "./types.js";
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
export declare class WeixinBot extends EventEmitter {
    private readonly sessionStore;
    private readonly client;
    private readonly auth;
    private session;
    private readonly initialSession;
    private sessionLoaded;
    private polling;
    private pollingOptions;
    private pollingPromise;
    private textListeners;
    private typingTicketCache;
    constructor(options?: WeixinBotOptions);
    on(event: "message", listener: (message: WeixinBotMessage) => void | Promise<void>): this;
    on(event: "text", listener: (message: WeixinBotMessage) => void | Promise<void>): this;
    on(event: "photo", listener: (message: WeixinBotMessage) => void | Promise<void>): this;
    on(event: "video", listener: (message: WeixinBotMessage) => void | Promise<void>): this;
    on(event: "document", listener: (message: WeixinBotMessage) => void | Promise<void>): this;
    on(event: "voice", listener: (message: WeixinBotMessage) => void | Promise<void>): this;
    on(event: "login", listener: (session: WeixinSession) => void | Promise<void>): this;
    on(event: "polling_error", listener: (error: unknown) => void | Promise<void>): this;
    onText(pattern: RegExp, listener: OnTextListener): this;
    private ensureSessionLoaded;
    private saveSession;
    getSession(): Promise<WeixinSession | null>;
    clearSession(): Promise<void>;
    useSession(session: WeixinSession): Promise<void>;
    createLoginSession(options?: {
        botType?: string;
        signal?: AbortSignal;
    }): Promise<LoginSession>;
    waitForLogin(sessionKey: string, options?: WaitForLoginOptions): Promise<LoginResult>;
    loginWithQr(options?: WaitForLoginOptions & {
        botType?: string;
    }): Promise<{
        loginSession: LoginSession;
        result: LoginResult;
    }>;
    getLatestContextToken(chatId: string): Promise<string | undefined>;
    private requireSession;
    private resolveContextToken;
    private rememberContextToken;
    sendMessage(chatId: string, text: string, options?: SendCommonOptions): Promise<{
        messageId: string;
    }>;
    sendPhoto(chatId: string, input: InputFile, options?: SendMediaOptions): Promise<{
        messageId: string;
    }>;
    sendVideo(chatId: string, input: InputFile, options?: SendMediaOptions): Promise<{
        messageId: string;
    }>;
    sendDocument(chatId: string, input: InputFile, options?: SendMediaOptions): Promise<{
        messageId: string;
    }>;
    sendTyping(chatId: string, options?: SendCommonOptions): Promise<void>;
    downloadMedia(message: WeixinBotMessage, options?: DownloadMediaOptions): Promise<DownloadMediaResult>;
    private normalizeMessage;
    private dispatchMessage;
    startPolling(options?: PollingOptions): Promise<void>;
    stopPolling(): Promise<void>;
}
