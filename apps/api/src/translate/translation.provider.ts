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
  // 只要有 URL 就算 external：**key 是可选的**。
  // 自建的 LibreTranslate（本机 127.0.0.1，不对外暴露）不需要 key；
  // 而旧规则要求 key 才认这个地址，等于把「不要钱的正式服务」排除在外。
  return env.TRANSLATION_API_URL ? "external" : "none";
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

/** MyMemory 一个候选条目（记忆库或机翻）。 */
type MyMemoryMatch = {
  translation?: unknown;
  quality?: unknown;
  mt?: unknown;
  "created-by"?: unknown;
};

/** 目标语是中日韩时，用它判断「乱码/音译混进来」这类条目。 */
const CJK_TARGETS = new Set(["zh", "ja", "ko"]);

/**
 * 从 MyMemory 的候选里挑一条真正像译文的。
 *
 * 为什么不能直接用它回的 `responseData.translatedText`：那只是 `matches[0]`，
 * 而记忆库的第一条经常是用户随手投稿的脏条目。实测（2026-10-06）：
 *
 *   en→zh "Hello, nice to meet you."
 *     matches[0] q=74  "359：哈啰 很高兴见到你"   ← 直接回就是这句
 *     matches[2] q=100 "你好，很高兴认识你"       ← 这才是要的
 *   ja→zh "こんにちは"
 *     matches[0] q=74  "penian ferein OU潘托斯所有安卓sofou"  ← 乱码
 *     matches[1] q=74  "你们好。"
 *     matches[2] q=80  "问候"（维基词条）
 *
 * 三条规则，每条都对应上面一个真实样本：
 *   1. **丢掉维基来源**：那是**词条标题**的对照，是释义不是译文
 *      （「问候」之于「こんにちは」）；
 *   2. **目标语是中日韩时丢掉夹拉丁字母的**：乱码/音译混入的典型长相；
 *   3. **剥掉「359：」这类编号前缀**：记忆库条目的常见污染。
 * 然后取 `quality` 最高的一条（同分时优先机翻条目）。
 */
function pickBestMyMemoryMatch(
  matches: MyMemoryMatch[],
  targetLang: string,
): { text: string } | null {
  const cjkTarget = CJK_TARGETS.has(myMemoryLang(targetLang).slice(0, 2));

  const candidates = matches
    .map((match) => ({
      text:
        typeof match.translation === "string"
          ? match.translation.replace(/^\s*\d+\s*[：:]\s*/, "").trim()
          : "",
      quality: Number(match.quality ?? 0) || 0,
      machine: match.mt === true || match["created-by"] === "MT!",
      fromWikipedia: match["created-by"] === "Wikipedia",
    }))
    .filter((candidate) => candidate.text.length > 0 && !candidate.fromWikipedia)
    .filter((candidate) => !(cjkTarget && /[A-Za-z]{3,}/.test(candidate.text)));

  if (candidates.length === 0) return null;
  const best = candidates.reduce((a, b) =>
    b.quality > a.quality || (b.quality === a.quality && b.machine && !a.machine) ? b : a,
  );
  return { text: best.text };
}

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
   * 请求体与鉴权沿用仓库既有约定：`{ q, source, target, format }`，
   * 响应兼容两种形状 —— LibreTranslate 的 `translatedText`、
   * Google Cloud Translation v2 的 `data.translations[0].translatedText`。
   *
   * **key 是可选的**（2026-10-06 改）：自建的 LibreTranslate 监听在本机，
   * 不对外暴露、不需要 key；有 key 时才带 `Bearer`（Google Cloud 用 OAuth token，
   * 云端付费实例用 key）。旧实现要求 URL + KEY 同时存在，结果是
   * 「零成本的正式服务」根本接不进来。
   */
  private async viaConfiguredEndpoint(
    content: string,
    sourceLang: string,
    targetLang: string,
  ): Promise<ExternalTranslation> {
    const endpoint = process.env.TRANSLATION_API_URL;
    if (!endpoint) return null;
    const apiKey = (process.env.TRANSLATION_API_KEY ?? "").trim();

    const payload = await this.fetchJson(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
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

    const payload = (await this.fetchJson(
      `https://api.mymemory.translated.net/get?${params.toString()}`,
    )) as { responseData?: { translatedText?: unknown }; matches?: MyMemoryMatch[] } | null;

    // 有候选就**只**看候选：挑不出来就是「这次没有可用的译文」，
    // 不再退回 `responseData.translatedText` —— 那玩意儿就是被我们筛掉的 `matches[0]`，
    // 退回去等于把刚扔掉的脏数据再端上来。没有候选时（例如额度用尽只回
    // 一句警告）才看 `responseData`，那种情况后面还有一道警告文本的检查。
    const hasMatches = Array.isArray(payload?.matches) && payload.matches.length > 0;
    const text = hasMatches
      ? (pickBestMyMemoryMatch(payload.matches as MyMemoryMatch[], targetLang)?.text ?? null)
      : typeof payload?.responseData?.translatedText === "string"
        ? payload.responseData.translatedText
        : null;
    if (!text) return null;
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
