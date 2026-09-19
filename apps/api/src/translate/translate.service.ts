import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TranslationProvider } from "./translation.provider";

const SUPPORTED = [
  "zh",
  "en",
  "ja",
  "ko",
  "es",
  "fr",
  "de",
  "ru",
  "pt",
  "it",
  "th",
  "vi",
  "id",
  "ms",
] as const;

type SupportedLang = (typeof SUPPORTED)[number];

type TranslateResult = {
  sourceLang: string;
  targetLang: string;
  text: string;
  provider: string;
  cached: boolean;
};

const DICTIONARY: Record<string, Partial<Record<SupportedLang, string>>> = {
  hello: { zh: "你好", en: "Hello", ja: "こんにちは", ko: "안녕하세요", es: "Hola", fr: "Bonjour" },
  "say hello! your talkfirst conversation just started.": {
    zh: "打个招呼吧！你们的 TalkFirst 对话开始了。",
    en: "Say hello! Your TalkFirst conversation just started.",
    ja: "挨拶しよう！TalkFirst の会話が始まりました。",
  },
  "let's practice languages together.": {
    zh: "我们一起练习语言吧。",
    en: "Let's practice languages together.",
    ja: "一緒に言語を練習しましょう。",
  },
};

@Injectable()
export class TranslateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: TranslationProvider,
  ) {}

  supported() {
    return [...SUPPORTED];
  }

  detect(text: string): SupportedLang {
    if (/[\u3040-\u30ff]/.test(text)) return "ja";
    if (/[\uac00-\ud7af]/.test(text)) return "ko";
    if (/[\u4e00-\u9fff]/.test(text)) return "zh";
    if (/[áéíóúñ¿¡]/i.test(text)) return "es";
    if (/[àâçèêëîïôûù]/i.test(text)) return "fr";
    return "en";
  }

  normalize(lang: string | undefined, fallback: SupportedLang): SupportedLang {
    const code = (lang ?? "").toLowerCase().slice(0, 2) as SupportedLang;
    return (SUPPORTED as readonly string[]).includes(code) ? code : fallback;
  }

  async translate(messageId: string, targetLangRaw: string | undefined, userId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { conversation: { include: { members: { select: { userId: true } } } } },
    });
    if (
      !message ||
      message.deletedAt ||
      !message.conversation.members.some((member) => member.userId === userId)
    ) {
      return null;
    }

    const sourceLang = this.detect(message.content);
    const targetLang = this.normalize(targetLangRaw, sourceLang === "en" ? "zh" : "en");
    if (sourceLang === targetLang) {
      return {
        sourceLang,
        targetLang,
        text: message.content,
        provider: "local-passthrough",
        cached: false,
      } satisfies TranslateResult;
    }

    const cached = await this.prisma.messageTranslation.findUnique({
      where: { messageId_targetLang: { messageId, targetLang } },
    });
    if (cached) {
      return {
        sourceLang,
        targetLang,
        text: cached.text,
        provider: cached.provider,
        cached: true,
      } satisfies TranslateResult;
    }

    const key = message.content.trim().toLowerCase();
    const dictionaryHit = DICTIONARY[key]?.[targetLang];
    if (dictionaryHit) {
      await this.saveCache(messageId, sourceLang, targetLang, dictionaryHit, "local-dictionary");
      return {
        sourceLang,
        targetLang,
        text: dictionaryHit,
        provider: "local-dictionary",
        cached: false,
      } satisfies TranslateResult;
    }

    const external = await this.provider.translateExternal(message.content, sourceLang, targetLang);
    if (external) {
      await this.saveCache(messageId, sourceLang, targetLang, external.text, external.provider);
      return {
        sourceLang,
        targetLang,
        text: external.text,
        provider: external.provider,
        cached: false,
      } satisfies TranslateResult;
    }

    const fallback = `[${targetLang}] ${message.content}（演示翻译：配置 TRANSLATION_API_URL + TRANSLATION_API_KEY 后接外部翻译）`;
    await this.saveCache(messageId, sourceLang, targetLang, fallback, "local-demo");
    return {
      sourceLang,
      targetLang,
      text: fallback,
      provider: "local-demo",
      cached: false,
    } satisfies TranslateResult;
  }

  private saveCache(
    messageId: string,
    sourceLang: string,
    targetLang: string,
    text: string,
    provider: string,
  ) {
    return this.prisma.messageTranslation
      .upsert({
        where: { messageId_targetLang: { messageId, targetLang } },
        update: { text, provider, sourceLang },
        create: { messageId, sourceLang, targetLang, text, provider },
      })
      .catch(() => null);
  }
}
