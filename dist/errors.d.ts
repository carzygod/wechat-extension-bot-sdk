export declare class WeixinSdkError extends Error {
    code: string;
    constructor(code: string, message: string, options?: {
        cause?: unknown;
    });
}
export declare class MissingContextTokenError extends WeixinSdkError {
    constructor(chatId: string);
}
export declare class SessionExpiredError extends WeixinSdkError {
    constructor(message?: string);
}
