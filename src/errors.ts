export class WeixinSdkError extends Error {
  code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WeixinSdkError";
    this.code = code;
  }
}

export class MissingContextTokenError extends WeixinSdkError {
  constructor(chatId: string) {
    super(
      "MISSING_CONTEXT_TOKEN",
      `No context token is available for chat "${chatId}". Wait for an inbound message or pass options.contextToken explicitly.`,
    );
    this.name = "MissingContextTokenError";
  }
}

export class SessionExpiredError extends WeixinSdkError {
  constructor(message = "Weixin bot session expired") {
    super("SESSION_EXPIRED", message);
    this.name = "SessionExpiredError";
  }
}
