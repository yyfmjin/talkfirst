import { Injectable, Logger } from "@nestjs/common";

/** LLM / 配置层错误：用稳定 code 表达，controller 转成 HTTP 错误或友好提示。 */
export class AiUnavailableError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

/**
 * 预设风格的提示词说明。键是写入数据库的 `stylePreset`，
 * 值会拼进系统提示词 —— 语言风格由 LLM 自己执行。
 */
export const STYLE_PRESETS: Record<string, string> = {
  gentle: "温柔体贴，说话柔软，善于安慰和鼓励",
  witty: "幽默风趣，爱开玩笑、接梗快，但拿捏分寸、不伤人不冒犯",
  calm: "沉稳理性，善于倾听与分析，给建议时条理清晰",
  energetic: "元气满满，热情活泼，喜欢分享新鲜事和新点子",
  warm: "暖心治愈，像深夜电台，总能把话题聊到心里去",
  listener: "安静专注的倾听者，回应克制但精准，偶尔犀利",
} as const;

export const STYLE_PRESET_KEYS = Object.keys(STYLE_PRESETS);

export type CompanionPersona = {
  name: string;
  userNickname: string;
  stylePreset: string | null;
  personality: string | null;
};

export type UserProfileForPrompt = {
  nickname: string | null;
  countryName: string | null;
  age: number | null;
  gender: string | null;
  bio: string | null;
  languages: string[];
  interests: string[];
  purposes: string[];
};

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  /**
   * 系统提示词：把「AI 朋友」的人设 + 用户真实资料 + 平台约束拼在一起。
   * 用词直接、指令明确 —— LLM 按它演一个朋友，而不是助手。
   */
  buildSystemPrompt(persona: CompanionPersona, profile: UserProfileForPrompt): string {
    const style = persona.stylePreset ? STYLE_PRESETS[persona.stylePreset] ?? null : null;
    const personalityLine = [style, persona.personality].filter(Boolean).join("；") || "真诚、友善、有分寸";

    const profileLines: string[] = [];
    if (profile.nickname) profileLines.push(`昵称：${profile.nickname}`);
    if (profile.countryName) profileLines.push(`来自：${profile.countryName}`);
    if (profile.age != null) profileLines.push(`年龄：${profile.age}`);
    if (profile.gender) profileLines.push(`性别：${profile.gender}`);
    if (profile.languages.length) profileLines.push(`会的语言：${profile.languages.join("、")}`);
    if (profile.interests.length) profileLines.push(`兴趣：${profile.interests.join("、")}`);
    if (profile.purposes.length) profileLines.push(`交友目的：${profile.purposes.join("、")}`);
    if (profile.bio) profileLines.push(`简介：${profile.bio}`);
    const profileBlock = profileLines.length ? `\n【关于${persona.userNickname}】\n${profileLines.join("\n")}` : "";

    return [
      `你是「${persona.name}」，用户 ${persona.userNickname} 在 TalkFirst（语言交换与跨文化社交应用）里的专属 AI 朋友。`,
      `你的性格设定：${personalityLine}。`,
      `你是一个像真人一样贴心的朋友，不是助手、不是客服、不是搜索引擎。`,
      profileBlock,
      ``,
      `【说话规则】`,
      `1. 用对方正在使用的语言回复；对方用中文就回中文，用别的语言就跟着用。`,
      `2. 像朋友一样自然聊天：有情绪、有回应、会追问、会分享自己的看法和日常；回复简短口语化（一般 1-4 句），不要列表、不要长篇大论、不要「作为一个AI」这类开场。`,
      `3. 称呼对方为「${persona.userNickname}」。`,
      `4. 你是 AI 朋友，这层身份不刻意强调，但绝不假装自己是真人，也不编造现实身份、照片或见面的承诺。`,
      `5. 不索取钱财或隐私；不提供医疗、法律、投资建议。对方情绪低落时先共情、陪伴，必要时温和建议寻求现实中的帮助。`,
      `6. 不生成露骨色情内容；若对方表露自伤倾向，温和劝说并建议联系信任的人或专业帮助。`,
    ]
      .filter((line) => line !== "")
      .join("\n");
  }

  /**
   * DeepSeek 兼容的 chat/completions 调用（无流式）。
   * 超时 60 秒；没有配置 key 时直接抛 `AI_NOT_CONFIGURED`。
   */
  async chat(
    system: string,
    history: Array<{ role: "user" | "assistant"; content: string }>,
    userText: string,
  ): Promise<string> {
    const apiKey = (process.env.AI_API_KEY ?? "").trim();
    if (!apiKey) {
      throw new AiUnavailableError("AI_NOT_CONFIGURED", "AI_API_KEY is not configured");
    }
    const base = (process.env.AI_API_URL ?? "https://api.deepseek.com/v1").replace(/\/+$/, "");
    const model = (process.env.AI_MODEL ?? "deepseek-chat").trim();

    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          ...history,
          { role: "user", content: userText },
        ],
        max_tokens: 600,
        temperature: 0.9,
        stream: false,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      this.logger.warn(`ai upstream error: ${response.status}`);
      throw new AiUnavailableError("AI_UPSTREAM_ERROR", `upstream responded ${response.status}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new AiUnavailableError("AI_EMPTY_REPLY", "upstream returned an empty reply");
    }
    return content.trim().slice(0, 2000);
  }
}
