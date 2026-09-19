import { Injectable } from "@nestjs/common";

export type ExternalTranslation = { text: string; provider: string } | null;

@Injectable()
export class TranslationProvider {
  async translateExternal(
    content: string,
    sourceLang: string,
    targetLang: string,
  ): Promise<ExternalTranslation> {
    const endpoint = process.env.TRANSLATION_API_URL;
    const apiKey = process.env.TRANSLATION_API_KEY;
    if (!endpoint || !apiKey) return null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ q: content, source: sourceLang, target: targetLang, format: "text" }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) return null;
      const payload = (await response.json().catch(() => null)) as {
        translatedText?: string;
        data?: { translations?: Array<{ translatedText?: string }> };
      } | null;
      const text =
        payload?.translatedText ?? payload?.data?.translations?.[0]?.translatedText ?? null;
      if (!text || typeof text !== "string") return null;
      return { text: text.slice(0, 2000), provider: "external" };
    } catch {
      return null;
    }
  }
}
