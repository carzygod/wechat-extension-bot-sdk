import { createRequire } from "node:module";

import { FileSessionStore, WeixinBot } from "weixin-claw-bot-sdk";

const require = createRequire(import.meta.url);
const qrcodeTerminal = require("qrcode-terminal");

const sessionStore = new FileSessionStore("./session.json");
const bot = new WeixinBot({ sessionStore });

function buildReplyText(message) {
  const original = message.text.trim();
  const timestamp = Date.now();
  const isoTime = new Date(timestamp).toISOString();

  return `${original}+1234+${timestamp}+${isoTime}`;
}

async function ensureLoggedIn() {
  const existingSession = await bot.getSession();
  if (existingSession?.token) {
    console.log(`[weixin-test] session loaded for account ${existingSession.accountId}`);
    return existingSession;
  }

  const loginSession = await bot.createLoginSession();
  console.log("[weixin-test] scan this QR with Weixin:");
  qrcodeTerminal.generate(loginSession.qrCodeUrl, { small: true });
  console.log("[weixin-test] QR URL:");
  console.log(loginSession.qrCodeUrl);

  const loginResult = await bot.waitForLogin(loginSession.sessionKey);
  if (!loginResult.connected || !loginResult.session) {
    throw new Error(`[weixin-test] login failed: ${loginResult.message}`);
  }

  console.log(`[weixin-test] login success: ${loginResult.session.accountId}`);
  return loginResult.session;
}

async function main() {
  const session = await ensureLoggedIn();

  bot.on("polling_error", (error) => {
    console.error("[weixin-test] polling error:", error);
  });

  bot.on("message", async (message) => {
    if (!message.chat.id) return;
    if (message.from.id === session.accountId) return;
    if (message.type !== "text" || typeof message.text !== "string" || !message.text.trim()) {
      console.log("[weixin-test] ignored non-text message:", {
        from: message.from.id,
        type: message.type,
      });
      return;
    }

    const replyText = buildReplyText(message);
    console.log("[weixin-test] inbound:", {
      from: message.from.id,
      type: message.type,
      text: message.text,
    });

    try {
      await bot.sendMessage(message.chat.id, replyText);
      console.log("[weixin-test] replied:", replyText);
    } catch (error) {
      console.error("[weixin-test] reply failed:", error);
    }
  });

  console.log("[weixin-test] polling started");
  await bot.startPolling();
}

main().catch((error) => {
  console.error("[weixin-test] fatal:", error);
  process.exitCode = 1;
});
