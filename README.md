# npm-test

Local smoke-test app for `@4claw/weixin-bot-sdk`.

Behavior:

1. If `session.json` exists, reuse it
2. Otherwise start QR login, print an ASCII QR in the terminal, and wait for confirmation
3. Start long polling
4. Reply only to inbound text messages
5. Reply format:

```text
<original-message>+1234+<timestamp-ms>+<iso-time>
```

## Run

```bash
npm install
npm run start
```

On first run, scan the printed QR URL with Weixin.

The session is persisted in `session.json`.
