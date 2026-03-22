import fs from "node:fs/promises";
import path from "node:path";

import type { SessionStore, WeixinSession } from "./types.js";

export class MemorySessionStore implements SessionStore {
  private session: WeixinSession | null;

  constructor(initialSession?: WeixinSession | null) {
    this.session = initialSession ?? null;
  }

  async load(): Promise<WeixinSession | null> {
    return this.session ? { ...this.session, contextTokens: { ...(this.session.contextTokens ?? {}) } } : null;
  }

  async save(session: WeixinSession): Promise<void> {
    this.session = { ...session, contextTokens: { ...(session.contextTokens ?? {}) } };
  }

  async clear(): Promise<void> {
    this.session = null;
  }
}

export class FileSessionStore implements SessionStore {
  readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
  }

  async load(): Promise<WeixinSession | null> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      return JSON.parse(raw) as WeixinSession;
    } catch {
      return null;
    }
  }

  async save(session: WeixinSession): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(session, null, 2), "utf-8");
  }

  async clear(): Promise<void> {
    try {
      await fs.unlink(this.filePath);
    } catch {
      // ignore
    }
  }
}
