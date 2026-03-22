import type { LoginResult, LoginSession, WaitForLoginOptions } from "./types.js";
import { WeixinApiClient } from "./client.js";
export declare class WeixinAuthManager {
    private readonly client;
    private readonly sessions;
    constructor(client: WeixinApiClient);
    createLoginSession(options?: {
        botType?: string;
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<LoginSession>;
    waitForLogin(sessionKey: string, options?: WaitForLoginOptions): Promise<LoginResult>;
    loginWithQr(options?: {
        botType?: string;
        timeoutMs?: number;
        refreshExpiredQr?: boolean;
        signal?: AbortSignal;
    }): Promise<{
        loginSession: LoginSession;
        result: LoginResult;
    }>;
}
