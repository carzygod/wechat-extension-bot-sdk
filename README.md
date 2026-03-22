# Weixin Bot SDK

TypeScript SDK for building custom Weixin bots on top of the iLink bot HTTP API.

## Features

- QR-code login flow
- Session persistence
- Long-polling `getUpdates`
- Event-style bot API
- Text, image, video, file sending
- Media download/decrypt helpers

## Install

```bash
npm install weixin-bot-sdk
```

## Quick Start

```ts
import { FileSessionStore, WeixinBot } from "weixin-bot-sdk";

const bot = new WeixinBot({
  sessionStore: new FileSessionStore("./weixin-session.json"),
});

const login = await bot.createLoginSession();
console.log("Scan:", login.qrCodeUrl);

await bot.waitForLogin(login.sessionKey);

bot.on("message", async (message) => {
  console.log("received:", message.type, message.chat.id, message.text);
});

bot.onText(/^\/ping$/i, async (message) => {
  await bot.sendMessage(message.chat.id, "pong");
});

await bot.startPolling();
```

## Important Limitation

The upstream Weixin API binds outbound replies to a conversation `context_token`.
This SDK caches the latest token per chat and uses it automatically.

That means:

- replying to an active chat works
- sending to a chat that never produced an inbound message will fail
- if the stored context token becomes invalid, you must wait for a new inbound message

## Main API

- `createLoginSession()`
- `waitForLogin(sessionKey)`
- `loginWithQr()`
- `startPolling()`
- `stopPolling()`
- `on("message" | "text" | "photo" | "video" | "document" | "voice")`
- `onText(regexp, listener)`
- `sendMessage(chatId, text, options?)`
- `sendPhoto(chatId, file, options?)`
- `sendVideo(chatId, file, options?)`
- `sendDocument(chatId, file, options?)`
- `sendTyping(chatId)`
- `downloadMedia(message, options?)`
