import { Injectable } from "@nestjs/common";

export type ExternalTranslation = { text: string; provider: string } | null;

/** 支持的传输方式。`none` = 主动交回调用方，走 `TranslateService` 的本地降级。 */
export type TranslationProviderKind = "external" | "mymemory" | "none";

/** Environment variable names owned by this module. */
export const TRANSLATION_PROVIDER_ENV = "TRANSLATION_PROVIDER";

/**
 * Picks the transport.
 *
 * 显式的 `TRANSLATION_PROVIDER` 永远优先；否则沿用原来的规则：URL + KEY 都配齐
 * 才走 `external`，否则 `none`。
 *
 * 为什么**不**在没配 key 时默认走免费的 MyMemory：那会让单元测试与 CI
 * 在没有网络的环境里真的发起请求（现在的默认行为是「一个请求都不发」）。
 * 免费通道必须被显式打开 —— 与 `MAIL_PROVIDER` 同一取向。
 */
export function resolveTranslationProviderKind(
  env: NodeJS.ProcessEnv = process.env,
): TranslationProviderKind {
  const raw = (env[TRANSLATION_PROVIDER_ENV] ?? "").trim().toLowerCase();
  if (raw === "external" || raw === "mymemory" || raw === "none") return raw;
  return env.TRANSLATION_API_URL && env.TRANSLATION_API_KEY ? "external" : "none";
}

/**
 * MyMemory 的语向码比 ISO-639-1 细一档：中文要写成 `zh-CN`，否则它往往拒答
 * 或给出空译文。其余两字母码它直接认（ja / ko / es / fr / de / ru …）。
 */
function myMemoryLang(code: string): string {
  return code.trim().toLowerCase() === "zh" ? "zh-CN" : code;
}

/** MyMemory 单次查询的上限（超过会回 `QUERY LENGTH LIMIT EXCEEDED`）。 */
const MYMEMORY_MAX_CHARS = 500;

/** 超时：与外部通道同一个 8 秒，超时就当作「这次没有译文」。 */
const TIMEOUT_MS = 8000;

@Injectable()
export class TranslationProvider {
  async translateExternal(
    content: string,
    sourceLang: string,
    targetLang: string,
  ): Promise<ExternalTranslation> {
    const kind = resolveTranslationProviderKind();
    if (kind === "none") return null;
    return kind === "mymemory"
      ? this.viaMyMemory(content, sourceLang, targetLang)
      : this.viaConfiguredEndpoint(content, sourceLang, targetLang);
  }

  /**
   * 自带的 / 自建的翻译服务（LibreTranslate 自托管，或任何接受同一形状的服务）。
   *
   * 请求体与鉴权沿用仓库既有约定：`{ q, source, target, format }` + `Bearer`，
   * 响应兼容两种形状 —— LibreTranslate 的 `translatedText`、
   * Google Cloud Translation v2 的 `data.translations[0].translatedText`。
   */
  private async viaConfiguredEndpoint(
    content: string,
    sourceLang: string,
    targetLang: string,
  ): Promise<ExternalTranslation> {
    const endpoint = process.env.TRANSLATION_API_URL;
    const apiKey = process.env.TRANSLATION_API_KEY;
    if (!endpoint || !apiKey) return null;

    const payload = await this.fetchJson(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ q: content, source: sourceLang, target: targetLang, format: "text" }),
    });

    const text =
      (payload as { translatedText?: string } | null)?.translatedText ??
      (payload as { data?: { translations?: Array<{ translatedText?: string }> } } | null)?.data
        ?.translations?.[0]?.translatedText ??
      null;
    if (!text || typeof text !== "string") return null;
    return { text: text.slice(0, 2000), provider: "external" };
  }

  /**
   * MyMemory —— 免费、无需注册的公共翻译接口（2026-10-06 实测可用）。
   *
   * 它是**先让功能跑起来**的临时通道，不是生产方案：
   *   · 匿名约 1000 词/天；带上 `de=<邮箱>` 可升到 10000 词/天（见 `TRANSLATION_CONTACT_EMAIL`）；
   *   · 共享公共实例，延迟与可用性都不保证；
   *   · 额度用尽时它**用 HTTP 200 回一句英文警告**，所以下面必须挡掉那种「译文」。
   *
   * 长文本会被截到 `MYMEMORY_MAX_CHARS`：接口对超长 `q` 直接报错，
   * 而聊天消息远短于此（静默截断在这里是刻意的取舍，不当成「完整翻译」）。
   */
  private async viaMyMemory(
    content: string,
    sourceLang: string,
    targetLang: string,
  ): Promise<ExternalTranslation> {
    const params = new URLSearchParams({
      q: content.slice(0, MYMEMORY_MAX_CHARS),
      langpair: `${myMemoryLang(sourceLang)}|${myMemoryLang(targetLang)}`,
    });
    const contact = (process.env.TRANSLATION_CONTACT_EMAIL ?? "").trim();
    if (contact) params.set("de", contact);

    const payload = await this.fetchJson(
      `https://api.mymemory.translated.net/get?${params.toString()}`,
    );

    const text = (payload as { responseData?: { translatedText?: unknown } } | null)?.responseData
      ?.translatedText;
    if (!text || typeof text !== "string") return null;
    // 额度用尽 / 查询过长时，警告文本是**当成译文**返回的，必须当失败处理，
    // 否则用户看到的「翻译结果」会是一句英文警告。
    if (/MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID/i.test(text)) return null;
    return { text: text.slice(0, 2000), provider: "mymemory" };
  }

  /** 统一的取 JSON：任何失败（网络、超时、非 2xx、坏 JSON）都返回 null。 */
  private async fetchJson(url: string, init?: RequestInit): Promise<unknown | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!response.ok) return null;
      return await response.json().catch(() => null);
    } catch {
      return null;
    } finally {
      // 必须在 finally：原实现在 throw 路径上不清定时器，
      // 等于每个失败的翻译请求都留下一个悬挂的 8 秒 timer。
      clearTimeout(timer);
    }
  }
}
