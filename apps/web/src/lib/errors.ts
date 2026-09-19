import { ApiRequestError } from "@/lib/api";

/**
 * PC-1.4: one place that turns an API error into member-facing Chinese copy.
 *
 * The API's `error.message` is written for developers ("This attribute is
 * already on your profile") while `error.code` is the stable contract, so known
 * codes are translated here. Anything unmapped falls back to the API's own
 * message rather than a generic string, so a real diagnostic is never swallowed
 * — but a Prisma/SQL/stack trace can never reach the screen, because only
 * `message` and `code` ever cross the HTTP boundary.
 */
const CODE_MESSAGES: Record<string, string> = {
  VALIDATION_ERROR: "填写的内容不符合要求，请检查后重试。",
  ATTRIBUTE_EXISTS: "这个标签已经添加过了。",
  ATTRIBUTE_NOT_FOUND: "这个标签已经不存在了，请刷新后重试。",
  MESSAGE_BLOCKED: "这段内容包含不被允许的信息，请修改后再试。",
  BLOCKED: "暂时无法查看这位用户。",
  USER_NOT_FOUND: "这位用户不存在或已停用。",
  UNAUTHORIZED: "登录状态已过期，请重新登录。",
  PERMISSION_DENIED: "你没有权限执行这个操作。",
  USER_SUSPENDED: "账号当前处于受限状态，暂时无法操作。",
  USER_BANNED: "账号已被封禁，暂时无法操作。",
  UNKNOWN_LANGUAGE_CODE: "包含无法识别的语言，请重新选择。",
  UNKNOWN_INTEREST_SLUG: "包含无法识别的兴趣标签，请重新选择。",
  UNKNOWN_PURPOSE_SLUG: "包含无法识别的交友目的，请重新选择。",
  UNKNOWN_COUNTRY_CODE: "包含无法识别的国家/地区，请重新选择。",
  INVALID_IMAGE: "头像链接无效，请使用 https 图片地址。",
  NETWORK_ERROR: "无法连接服务器，请检查网络后重试。",
};

export function friendlyErrorMessage(error: unknown, fallback = "操作失败，请稍后再试。"): string {
  if (error instanceof ApiRequestError) {
    return CODE_MESSAGES[error.code] ?? (error.message || fallback);
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
