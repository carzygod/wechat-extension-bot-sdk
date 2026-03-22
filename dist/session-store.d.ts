import type { SessionStore, WeixinSession } from "./types.js";
export declare class MemorySessionStore implements SessionStore {
    private session;
    constructor(initialSession?: WeixinSession | null);
    load(): Promise<WeixinSession | null>;
    save(session: WeixinSession): Promise<void>;
    clear(): Promise<void>;
}
export declare class FileSessionStore implements SessionStore {
    readonly filePath: string;
    constructor(filePath: string);
    load(): Promise<WeixinSession | null>;
    save(session: WeixinSession): Promise<void>;
    clear(): Promise<void>;
}
