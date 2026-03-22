import fs from "node:fs/promises";
import path from "node:path";
export class MemorySessionStore {
    session;
    constructor(initialSession) {
        this.session = initialSession ?? null;
    }
    async load() {
        return this.session ? { ...this.session, contextTokens: { ...(this.session.contextTokens ?? {}) } } : null;
    }
    async save(session) {
        this.session = { ...session, contextTokens: { ...(session.contextTokens ?? {}) } };
    }
    async clear() {
        this.session = null;
    }
}
export class FileSessionStore {
    filePath;
    constructor(filePath) {
        this.filePath = path.resolve(filePath);
    }
    async load() {
        try {
            const raw = await fs.readFile(this.filePath, "utf-8");
            return JSON.parse(raw);
        }
        catch {
            return null;
        }
    }
    async save(session) {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        await fs.writeFile(this.filePath, JSON.stringify(session, null, 2), "utf-8");
    }
    async clear() {
        try {
            await fs.unlink(this.filePath);
        }
        catch {
            // ignore
        }
    }
}
//# sourceMappingURL=session-store.js.map