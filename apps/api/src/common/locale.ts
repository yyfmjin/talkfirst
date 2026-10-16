import type { PrismaService } from "../prisma/prisma.service";
import {
  DEFAULT_LOCALE,
  type SupportedLocale,
  localeFromAcceptLanguage,
  resolveLocale,
} from "./i18n";

/**
 * 「服务端该用哪种语言给这个人发文案」的唯一答案。
 *
 * 为什么单独成层：通知（`NotificationService`）和邮件（`VerificationService`）
 * 都要做这个判断，而它必须完全一致 —— 两处各写一份，早晚会出现「通知是英文、
 * 验证码邮件是中文」这种更难解释的不一致。
 *
 * 顺序：显式选择的界面语言 → 母语 → 中文兜底。两个出口都**不抛异常**：
 * 拿不准语言只是文案不好看，不该让通知或验证码发不出去。
 */

type LanguageRow = { languageCode: string; type: string };

/** 母语排在前面：老账号没有 `locale` 字段，母语是那时唯一可信的信号。 */
function orderedLanguageCodes(rows: ReadonlyArray<LanguageRow>): string[] {
  return [
    ...rows.filter((row) => row.type === "NATIVE"),
    ...rows.filter((row) => row.type !== "NATIVE"),
  ].map((row) => row.languageCode);
}

const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 5_000;
const cache = new Map<string, { locale: SupportedLocale; at: number }>();

/** 测试用：清空缓存，让下一个用例不受上一个用例的影响。 */
export function clearLocaleCache(): void {
  cache.clear();
}

/**
 * 某个用户的语言。
 *
 * 缓存 60 秒：群聊里连着来消息时，不该每条通知都回一次数据库；而 60 秒又短到
 * 用户切换语言后下一批通知就跟着变。
 */
export async function localeForUserId(
  prisma: PrismaService,
  userId: string,
): Promise<SupportedLocale> {
  const now = Date.now();
  const cached = cache.get(userId);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.locale;

  let locale = DEFAULT_LOCALE;
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        locale: true,
        languages: { select: { languageCode: true, type: true } },
      },
    });
    locale = resolveLocale({
      locale: user?.locale,
      languageCodes: orderedLanguageCodes(user?.languages ?? []),
    });
  } catch {
    // 降级：查不到语言就用兜底语言，通知照发。调用方看到的是「一条中文通知」，
    // 而不是「没有通知」。
    return DEFAULT_LOCALE;
  }

  if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
  cache.set(userId, { locale, at: now });
  return locale;
}

/**
 * 发到某个邮箱的文案用什么语言。
 *
 * 账号已存在时以**账号设置**为准；账号还不存在（注册验证码）时只能看请求头
 * —— 那是唯一能表达「这个人现在想看什么语言」的信号。
 *
 * 这里不查缓存：邮件量小，而缓存反而会让「刚改完语言就重发验证码」看不出效果。
 */
export async function localeForEmail(
  prisma: PrismaService,
  email: string,
  acceptLanguage?: string | null,
): Promise<SupportedLocale> {
  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        locale: true,
        languages: { select: { languageCode: true, type: true } },
      },
    });
    if (user) {
      return resolveLocale({
        locale: user.locale,
        languageCodes: orderedLanguageCodes(user.languages),
      });
    }
  } catch {
    // 降级到请求头：一次查询失败不该让验证码发不出去。
  }
  return localeFromAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE;
}
