import { ApiRequestError } from "@/lib/api";
import { currentLocale, DEFAULT_LOCALE, type Locale } from "@/lib/i18n";

/**
 * PC-1.4：**唯一**把 API 错误转成成员可读文案的地方。
 *
 * API 的 `error.message` 是写给开发者的（"This attribute is already on your
 * profile"），而 `error.code` 才是稳定契约 —— 已知 code 在这里翻译。
 * 没映上的落回 API 自己的 message 而不是一句泛泛的套话，这样真实诊断不会被吞掉；
 * 但 Prisma/SQL/堆栈永远到不了屏幕，因为只有 `message` 与 `code` 过得了 HTTP 边界。
 *
 * ## 语言（2026-10-16）
 *
 * 文案按 `currentLocale()` 选（路由决定语言，与 `useLocale()` 同一条规则）。
 * 调用方仍可传 `locale` 显式覆盖（有 hook 的地方已有准确的 locale）。
 *
 * ⚠️ **`fallback` 参数仍是调用方给的字符串**：现有调用点里还有十几处写死的中文
 * 兜底句（如「保存失败，请稍后再试」），它们在那几个页面双语化时改成 `t(...)`。
 * 没写死兜底的调用点、以及所有 code 映射的句子，已经跟着界面语言走。
 */
const CODE_MESSAGES: Record<Locale, Record<string, string>> = {
  zh: {
    VALIDATION_ERROR: "填写的内容不符合要求，请检查后重试。",
    ATTRIBUTE_EXISTS: "这个标签已经添加过了。",
    ATTRIBUTE_NOT_FOUND: "这个标签已经不存在了，请刷新后重试。",
    MESSAGE_BLOCKED: "这段内容包含不被允许的信息，请修改后再试。",
    BLOCKED: "暂时无法查看这位用户。",
    USER_NOT_FOUND: "这位用户不存在或已停用。",
    UNAUTHORIZED: "登录状态已过期，请重新登录。",
    PERMISSION_DENIED: "你没有权限执行这个操作。",
    USER_SUSPENDED: "账号当前处于限制状态，暂时无法操作。",
    USER_BANNED: "账号已被封禁，暂时无法操作。",
    UNKNOWN_LANGUAGE_CODE: "包含无法识别的语言，请重新选择。",
    UNKNOWN_INTEREST_SLUG: "包含无法识别的兴趣标签，请重新选择。",
    UNKNOWN_PURPOSE_SLUG: "包含无法识别的交友目的，请重新选择。",
    UNKNOWN_COUNTRY_CODE: "包含无法识别的国家/地区，请重新选择。",
    INVALID_IMAGE: "头像链接无效，请使用 https 图片地址。",
    NETWORK_ERROR: "无法连接服务器，请检查网络后重试。",
    // PC-2.5.4 — the report endpoint's own refusals, mapped once here rather
    // than in a second dictionary beside the report dialog.
    MOMENT_NOT_FOUND: "这条动态不存在或已被删除。",
    MOMENT_LOCKED: "这条动态暂时无法查看。",
    CANNOT_REPORT_SELF: "不能举报自己发布的内容。",
    INVALID_REASON: "请选择一个有效的举报原因。",
    // Editing / deleting what one published. The ownership refusals are the ones
    // a member can actually reach, because the menu is the only thing that knows
    // whose post this is and a hidden control is not a boundary.
    MOMENT_FORBIDDEN: "只能修改或删除自己发布的动态。",
    EMPTY_CONTENT: "动态内容不能为空，至少保留一张照片或一个视频。",
    CONTENT_BLOCKED: "这段内容包含不被允许的信息，请修改后再试。",
  },
  en: {
    VALIDATION_ERROR: "Some fields need fixing — check them and try again.",
    ATTRIBUTE_EXISTS: "That tag is already on your profile.",
    ATTRIBUTE_NOT_FOUND: "That tag no longer exists — refresh and try again.",
    MESSAGE_BLOCKED: "This message contains something we don't allow. Edit it and try again.",
    BLOCKED: "You can't view this member right now.",
    USER_NOT_FOUND: "This member doesn't exist or is no longer active.",
    UNAUTHORIZED: "Your session expired. Please sign in again.",
    PERMISSION_DENIED: "You don't have permission to do that.",
    USER_SUSPENDED: "Your account is restricted right now, so this can't be done.",
    USER_BANNED: "Your account is banned, so this can't be done.",
    UNKNOWN_LANGUAGE_CODE: "That language isn't recognised — pick it again.",
    UNKNOWN_INTEREST_SLUG: "That interest isn't recognised — pick it again.",
    UNKNOWN_PURPOSE_SLUG: "That purpose isn't recognised — pick it again.",
    UNKNOWN_COUNTRY_CODE: "That country isn't recognised — pick it again.",
    INVALID_IMAGE: "That image link isn't valid — use an https image URL.",
    NETWORK_ERROR: "Can't reach the server. Check your connection and try again.",
    MOMENT_NOT_FOUND: "This moment doesn't exist or was deleted.",
    MOMENT_LOCKED: "This moment isn't visible right now.",
    CANNOT_REPORT_SELF: "You can't report your own post.",
    INVALID_REASON: "Pick a valid reason for the report.",
    MOMENT_FORBIDDEN: "You can only edit or delete your own moments.",
    EMPTY_CONTENT: "A moment can't be empty — keep at least one photo or video.",
    CONTENT_BLOCKED: "This content contains something we don't allow. Edit it and try again.",
  },
};

/** 没有具体 code 时的兜底句（也是按语言）。 */
const DEFAULT_FALLBACK: Record<Locale, string> = {
  zh: "操作失败，请稍后再试。",
  en: "Something went wrong. Please try again.",
};

export function friendlyErrorMessage(
  error: unknown,
  fallback?: string,
  locale: Locale = currentLocale(),
): string {
  const generic = fallback ?? DEFAULT_FALLBACK[locale] ?? DEFAULT_FALLBACK[DEFAULT_LOCALE];
  if (error instanceof ApiRequestError) {
    return CODE_MESSAGES[locale]?.[error.code] ?? (error.message || generic);
  }
  if (error instanceof Error && error.message) return error.message;
  return generic;
}
