import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const INTERESTS = [
  { slug: "minecraft", name: "Minecraft", nameZh: "Minecraft", category: "Gaming", sort: 1 },
  { slug: "valorant", name: "Valorant", nameZh: "Valorant", category: "Gaming", sort: 2 },
  { slug: "gta", name: "GTA", nameZh: "GTA", category: "Gaming", sort: 3 },
  { slug: "steam", name: "Steam", nameZh: "Steam", category: "Gaming", sort: 4 },
  { slug: "nintendo", name: "Nintendo", nameZh: "任天堂", category: "Gaming", sort: 5 },
  { slug: "pop", name: "Pop", nameZh: "流行", category: "Music", sort: 6 },
  { slug: "rock", name: "Rock", nameZh: "摇滚", category: "Music", sort: 7 },
  { slug: "hip-hop", name: "Hip-Hop", nameZh: "嘻哈", category: "Music", sort: 8 },
  { slug: "kpop", name: "K-pop", nameZh: "K-pop", category: "Music", sort: 9 },
  { slug: "travel-jp", name: "Japan Travel", nameZh: "日本旅行", category: "Travel", sort: 10 },
  { slug: "travel-kr", name: "Korea Travel", nameZh: "韩国旅行", category: "Travel", sort: 11 },
  { slug: "travel-uk", name: "UK Travel", nameZh: "英国旅行", category: "Travel", sort: 12 },
  { slug: "photography", name: "Photography", nameZh: "摄影", category: "Lifestyle", sort: 13 },
  { slug: "movies", name: "Movies", nameZh: "电影", category: "Lifestyle", sort: 14 },
  { slug: "food", name: "Food", nameZh: "美食", category: "Lifestyle", sort: 15 },
  { slug: "anime", name: "Anime", nameZh: "动漫", category: "Culture", sort: 16 },
  { slug: "language-exchange", name: "Language Exchange", nameZh: "语言交换", category: "Culture", sort: 17 },
  { slug: "culture", name: "Culture", nameZh: "文化", category: "Culture", sort: 18 },
];

const PURPOSES = [
  { slug: "language-exchange", name: "Language Exchange", nameZh: "语言交换", sort: 1 },
  { slug: "making-friends", name: "Making Friends", nameZh: "交朋友", sort: 2 },
  { slug: "gaming", name: "Gaming Buddy", nameZh: "游戏搭子", sort: 3 },
  { slug: "travel", name: "Travel", nameZh: "旅行", sort: 4 },
  { slug: "music", name: "Music", nameZh: "音乐", sort: 5 },
  { slug: "study", name: "Study Together", nameZh: "一起学习", sort: 6 },
  { slug: "culture", name: "Culture Exchange", nameZh: "文化交流", sort: 7 },
];

const LANGUAGES = [
  { code: "zh", name: "Chinese", nativeName: "中文" },
  { code: "en", name: "English", nativeName: "English" },
  { code: "ja", name: "Japanese", nativeName: "日本語" },
  { code: "ko", name: "Korean", nativeName: "한국어" },
  { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "fr", name: "French", nativeName: "Français" },
  { code: "de", name: "German", nativeName: "Deutsch" },
  { code: "ru", name: "Russian", nativeName: "Русский" },
  { code: "pt", name: "Portuguese", nativeName: "Português" },
  { code: "it", name: "Italian", nativeName: "Italiano" },
  { code: "th", name: "Thai", nativeName: "ไทย" },
  { code: "vi", name: "Vietnamese", nativeName: "Tiếng Việt" },
  { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia" },
  { code: "ms", name: "Malay", nativeName: "Bahasa Melayu" },
  { code: "ar", name: "Arabic", nativeName: "العربية" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी" },
  { code: "tr", name: "Turkish", nativeName: "Türkçe" },
  { code: "nl", name: "Dutch", nativeName: "Nederlands" },
  { code: "pl", name: "Polish", nativeName: "Polski" },
  { code: "uk", name: "Ukrainian", nativeName: "Українська" },
];

const COUNTRIES = [
  { code: "CN", name: "China", flag: "🇨🇳" },
  { code: "US", name: "United States", flag: "🇺🇸" },
  { code: "JP", name: "Japan", flag: "🇯🇵" },
  { code: "KR", name: "South Korea", flag: "🇰🇷" },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧" },
  { code: "DE", name: "Germany", flag: "🇩🇪" },
  { code: "FR", name: "France", flag: "🇫🇷" },
  { code: "CA", name: "Canada", flag: "🇨🇦" },
  { code: "AU", name: "Australia", flag: "🇦🇺" },
  { code: "SG", name: "Singapore", flag: "🇸🇬" },
  { code: "TH", name: "Thailand", flag: "🇹🇭" },
  { code: "VN", name: "Vietnam", flag: "🇻🇳" },
  { code: "MY", name: "Malaysia", flag: "🇲🇾" },
  { code: "ID", name: "Indonesia", flag: "🇮🇩" },
  { code: "PH", name: "Philippines", flag: "🇵🇭" },
  { code: "IN", name: "India", flag: "🇮🇳" },
  { code: "BR", name: "Brazil", flag: "🇧🇷" },
  { code: "MX", name: "Mexico", flag: "🇲🇽" },
  { code: "ES", name: "Spain", flag: "🇪🇸" },
  { code: "IT", name: "Italy", flag: "🇮🇹" },
];

// PC-1.3: the selectable system tag catalog consumed by GET /meta/attributes.
// Both English and Chinese labels ship (Q4). `isActive` is intentionally
// absent from the update branch: retiring a tag is an admin decision, and
// re-running the seed must not resurrect it.
const ATTRIBUTE_DEFINITIONS = [
  // ABOUT_ME - how a user describes themselves.
  { key: "about-gaming", kind: "ABOUT_ME", category: "Hobby", label: "Gaming", labelZh: "游戏", sort: 1 },
  { key: "about-music", kind: "ABOUT_ME", category: "Hobby", label: "Music", labelZh: "音乐", sort: 2 },
  { key: "about-travel", kind: "ABOUT_ME", category: "Hobby", label: "Travel", labelZh: "旅行", sort: 3 },
  { key: "about-photography", kind: "ABOUT_ME", category: "Hobby", label: "Photography", labelZh: "摄影", sort: 4 },
  { key: "about-anime", kind: "ABOUT_ME", category: "Hobby", label: "Anime", labelZh: "动漫", sort: 5 },
  { key: "about-movies", kind: "ABOUT_ME", category: "Hobby", label: "Movies", labelZh: "电影", sort: 6 },
  { key: "about-food", kind: "ABOUT_ME", category: "Lifestyle", label: "Food", labelZh: "美食", sort: 7 },
  { key: "about-reading", kind: "ABOUT_ME", category: "Hobby", label: "Reading", labelZh: "阅读", sort: 8 },
  { key: "about-programming", kind: "ABOUT_ME", category: "Hobby", label: "Programming", labelZh: "编程", sort: 9 },
  { key: "about-sports", kind: "ABOUT_ME", category: "Hobby", label: "Sports", labelZh: "运动", sort: 10 },
  { key: "about-board-games", kind: "ABOUT_ME", category: "Hobby", label: "Board Games", labelZh: "桌游", sort: 11 },
  { key: "about-city-pop", kind: "ABOUT_ME", category: "Music", label: "City Pop", labelZh: "City Pop", sort: 12 },
  { key: "about-night-owl", kind: "ABOUT_ME", category: "Lifestyle", label: "Night Owl", labelZh: "夜猫子", sort: 13 },
  { key: "about-slow-warmup", kind: "ABOUT_ME", category: "Personality", label: "Slow to Warm Up", labelZh: "慢热", sort: 14 },
  { key: "about-long-chats", kind: "ABOUT_ME", category: "Communication", label: "Long Chats", labelZh: "喜欢长聊天", sort: 15 },
  // LOOKING_FOR - who the user wants to meet. Q4 requires the first five.
  { key: "looking-language-exchange", kind: "LOOKING_FOR", category: "Culture", label: "Language Exchange", labelZh: "语言交换", sort: 1 },
  { key: "looking-gaming-buddy", kind: "LOOKING_FOR", category: "Gaming", label: "Gaming Buddy", labelZh: "游戏好友", sort: 2 },
  { key: "looking-local-friends", kind: "LOOKING_FOR", category: "Social", label: "Local Friends", labelZh: "同城朋友", sort: 3 },
  { key: "looking-travel-buddy", kind: "LOOKING_FOR", category: "Travel", label: "Travel Buddy", labelZh: "旅行伙伴", sort: 4 },
  { key: "looking-culture-exchange", kind: "LOOKING_FOR", category: "Culture", label: "Culture Exchange", labelZh: "文化交流", sort: 5 },

  /**
   * P0-03 的补齐（2026-10-04）。上一版只出厂了 1 个性格标签与 1 个交流方式标签，
   * 等于这两个板块实际上不可用；能力（模型、校验、上限、可见性）早就在了，缺的只是可选内容。
   *
   * 两条判断写在这里，免得后来者以为是遗漏：
   *   - 「慢热」只留在性格（`about-slow-warmup`）。P0-03 的文案在两处都列了它，但同一个词
   *     挂在两个 section 上会让人以为它们是不同选项。一个词一个归属。
   *   - 英文 label 直说意思，不做逐字对译（`Takes the Lead` 而不是 `Like to Initiate`）。
   */
  { key: "about-outgoing", kind: "ABOUT_ME", category: "Personality", label: "Outgoing", labelZh: "外向", sort: 16 },
  { key: "about-introverted", kind: "ABOUT_ME", category: "Personality", label: "Introverted", labelZh: "内向", sort: 17 },
  { key: "about-humorous", kind: "ABOUT_ME", category: "Personality", label: "Humorous", labelZh: "幽默", sort: 18 },
  { key: "about-curious", kind: "ABOUT_ME", category: "Personality", label: "Curious", labelZh: "好奇", sort: 19 },
  { key: "about-quiet", kind: "ABOUT_ME", category: "Personality", label: "Quiet", labelZh: "安静", sort: 20 },
  { key: "about-talkative", kind: "ABOUT_ME", category: "Personality", label: "Talkative", labelZh: "健谈", sort: 21 },
  { key: "about-easygoing", kind: "ABOUT_ME", category: "Personality", label: "Easygoing", labelZh: "随和", sort: 22 },
  { key: "about-text-chats", kind: "ABOUT_ME", category: "Communication", label: "Text Chats", labelZh: "文字聊天", sort: 23 },
  { key: "about-voice-chats", kind: "ABOUT_ME", category: "Communication", label: "Voice Chats", labelZh: "语音聊天", sort: 24 },
  { key: "about-chat-occasionally", kind: "ABOUT_ME", category: "Communication", label: "Chat Occasionally", labelZh: "偶尔聊天", sort: 25 },
  { key: "about-chat-often", kind: "ABOUT_ME", category: "Communication", label: "Chat Often", labelZh: "经常聊天", sort: 26 },
  { key: "about-chat-initiator", kind: "ABOUT_ME", category: "Communication", label: "Takes the Lead", labelZh: "喜欢主动聊天", sort: 27 },
  { key: "about-tech", kind: "ABOUT_ME", category: "Hobby", label: "Tech", labelZh: "科技", sort: 28 },
  { key: "looking-international-friends", kind: "LOOKING_FOR", category: "Social", label: "International Friends", labelZh: "国际朋友", sort: 6 },
  { key: "looking-deep-chat", kind: "LOOKING_FOR", category: "Social", label: "Deep Conversations", labelZh: "深度聊天", sort: 7 },
  { key: "looking-daily-chat", kind: "LOOKING_FOR", category: "Social", label: "Everyday Chat", labelZh: "日常聊天", sort: 8 },
];

const TEST_USERS = [
  {
    email: "yuki.demo@talkfirst.local",
    /**
     * Demo accounts get readable account names instead of generated ones.
     *
     * A seed is documentation as much as data: `yukidemo` can be typed at the
     * sign-in form, while a random handle cannot be remembered or quoted in a
     * test. Both are valid under the same rules (`[a-z0-9]`, 8-30).
     */
    username: "yukidemo",
    nickname: "Yuki",
    countryCode: "JP",
    birthDate: "2000-06-18",
    bio: "Learning Chinese and looking for friends to talk about games, anime and travel.",
    interests: ["minecraft", "anime", "travel-jp"],
    purposes: ["language-exchange", "culture"],
    native: "ja",
    learning: "zh",
  },
  {
    email: "alex.demo@talkfirst.local",
    username: "alexdemo",
    nickname: "Alex",
    countryCode: "US",
    birthDate: "1999-03-12",
    bio: "I want to practice Chinese and share music, food and city walks.",
    interests: ["minecraft", "pop", "food"],
    purposes: ["language-exchange", "making-friends"],
    native: "en",
    learning: "zh",
  },
  {
    email: "mika.demo@talkfirst.local",
    username: "mikademo",
    nickname: "Mika",
    countryCode: "KR",
    birthDate: "2001-11-02",
    bio: "K-pop, photography and language exchange. Say hello!",
    interests: ["kpop", "photography", "language-exchange"],
    purposes: ["culture", "making-friends"],
    native: "ko",
    learning: "en",
  },
];

async function main() {
  // Phase 13 migration runs via `migrate deploy`. Local `db-check` uses the
  // seeded SchemaMeta phase, so keep both in sync here.
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "AdminAuditLog" ("id" UUID NOT NULL, "adminId" UUID NOT NULL, "action" VARCHAR(64) NOT NULL, "targetId" UUID, "detail" VARCHAR(2000), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id"))`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "AdminAuditLog_adminId_createdAt_idx" ON "AdminAuditLog"("adminId", "createdAt")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "MessageTranslation" ("id" UUID NOT NULL, "messageId" UUID NOT NULL, "sourceLang" VARCHAR(8) NOT NULL, "targetLang" VARCHAR(8) NOT NULL, "text" VARCHAR(2000) NOT NULL, "provider" VARCHAR(32) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "MessageTranslation_pkey" PRIMARY KEY ("id"))`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "MessageTranslation_messageId_targetLang_key" ON "MessageTranslation"("messageId", "targetLang")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "MessageTranslation_messageId_idx" ON "MessageTranslation"("messageId")`,
  );
  await prisma.$executeRawUnsafe(`ALTER TYPE "SocialPlatform" ADD VALUE IF NOT EXISTS 'YOUTUBE'`);
  await prisma.$executeRawUnsafe(`ALTER TYPE "SocialPlatform" ADD VALUE IF NOT EXISTS 'FACEBOOK'`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "SocialAccount" ADD COLUMN IF NOT EXISTS "syncEnabled" BOOLEAN NOT NULL DEFAULT false`);
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "MomentPlatformBinding" ("id" UUID NOT NULL, "userId" UUID NOT NULL, "platform" "SocialPlatform" NOT NULL, "handle" VARCHAR(128) NOT NULL, "displayName" VARCHAR(128), "syncEnabled" BOOLEAN NOT NULL DEFAULT true, "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "MomentPlatformBinding_pkey" PRIMARY KEY ("id"))`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "MomentPlatformBinding_userId_platform_key" ON "MomentPlatformBinding"("userId", "platform")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "MomentPlatformBinding_userId_idx" ON "MomentPlatformBinding"("userId")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "MomentSetting" ("userId" UUID NOT NULL, "syncEnabled" BOOLEAN NOT NULL DEFAULT false, "visibleTo" VARCHAR(16) NOT NULL DEFAULT 'everyone', "filterSensitive" BOOLEAN NOT NULL DEFAULT true, "showPhotos" BOOLEAN NOT NULL DEFAULT true, "showVideos" BOOLEAN NOT NULL DEFAULT true, "showTexts" BOOLEAN NOT NULL DEFAULT true, "showReels" BOOLEAN NOT NULL DEFAULT true, "showLives" BOOLEAN NOT NULL DEFAULT false, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "MomentSetting_pkey" PRIMARY KEY ("userId"))`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "Moment" ("id" UUID NOT NULL, "userId" UUID NOT NULL, "platform" "SocialPlatform" NOT NULL, "platformName" VARCHAR(32), "content" VARCHAR(2000) NOT NULL, "images" TEXT[] NOT NULL DEFAULT '{}', "videoUrl" VARCHAR(2000), "durationSec" INTEGER, "tags" TEXT[] NOT NULL DEFAULT '{}', "likeCount" INTEGER NOT NULL DEFAULT 0, "commentCount" INTEGER NOT NULL DEFAULT 0, "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "Moment_pkey" PRIMARY KEY ("id"))`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "Moment_userId_createdAt_idx" ON "Moment"("userId", "createdAt")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "Moment_platform_createdAt_idx" ON "Moment"("platform", "createdAt")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "Moment_createdAt_idx" ON "Moment"("createdAt")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "MomentLike" ("momentId" UUID NOT NULL, "userId" UUID NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "MomentLike_pkey" PRIMARY KEY ("momentId", "userId"))`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "MomentLike_userId_idx" ON "MomentLike"("userId")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "MomentComment" ("id" UUID NOT NULL, "momentId" UUID NOT NULL, "userId" UUID NOT NULL, "content" VARCHAR(500) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "MomentComment_pkey" PRIMARY KEY ("id"))`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "MomentComment_momentId_createdAt_idx" ON "MomentComment"("momentId", "createdAt")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "MomentComment_userId_idx" ON "MomentComment"("userId")`,
  );
  await prisma.schemaMeta.upsert({
    where: { id: "talkfirst" },
    update: { phase: "15-moments" },
    create: { id: "talkfirst", phase: "15-moments" },
  });

  for (const item of INTERESTS) {
    await prisma.interest.upsert({ where: { slug: item.slug }, update: item, create: item });
  }
  for (const item of PURPOSES) {
    await prisma.purpose.upsert({ where: { slug: item.slug }, update: item, create: item });
  }
  for (const item of LANGUAGES) {
    await prisma.language.upsert({ where: { code: item.code }, update: item, create: item });
  }
  for (const item of COUNTRIES) {
    await prisma.country.upsert({ where: { code: item.code }, update: item, create: item });
  }

  for (const item of ATTRIBUTE_DEFINITIONS) {
    const { key, ...rest } = item;
    await prisma.attributeDefinition.upsert({
      where: { key },
      update: rest,
      create: { key, ...rest },
    });
  }

  const passwordHash = await bcrypt.hash("password123", 12);
  for (const fixture of TEST_USERS) {
    const user = await prisma.user.upsert({
      where: { email: fixture.email },
      update: {
        nickname: fixture.nickname,
        countryCode: fixture.countryCode,
        birthDate: new Date(fixture.birthDate),
        bio: fixture.bio,
        emailVerified: true,
        lastActiveAt: new Date(),
      },
      create: {
        email: fixture.email,
        username: fixture.username,
        passwordHash,
        nickname: fixture.nickname,
        countryCode: fixture.countryCode,
        birthDate: new Date(fixture.birthDate),
        bio: fixture.bio,
        emailVerified: true,
        lastActiveAt: new Date(),
      },
    });
    await prisma.userLanguage.deleteMany({ where: { userId: user.id } });
    await prisma.userLanguage.createMany({
      data: [
        { userId: user.id, languageCode: fixture.native, type: "NATIVE", level: "NATIVE" },
        { userId: user.id, languageCode: fixture.learning, type: "LEARNING", level: "INTERMEDIATE" },
      ],
    });

    await prisma.userInterest.deleteMany({ where: { userId: user.id } });
    const interests = await prisma.interest.findMany({ where: { slug: { in: fixture.interests } } });
    await prisma.userInterest.createMany({ data: interests.map((interest) => ({ userId: user.id, interestId: interest.id })) });

    await prisma.userPurpose.deleteMany({ where: { userId: user.id } });
    const purposes = await prisma.purpose.findMany({ where: { slug: { in: fixture.purposes } } });
    await prisma.userPurpose.createMany({ data: purposes.map((purpose) => ({ userId: user.id, purposeId: purpose.id })) });
  }

  const bootstrapAdmin = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
  if (bootstrapAdmin) {
    await prisma.user.updateMany({ where: { email: bootstrapAdmin }, data: { isAdmin: true, status: "ACTIVE" } });
  }
  const adminCount = await prisma.user.count({ where: { isAdmin: true } });
  console.log(`SEED_OK phase=11-hardening admins=${adminCount}`);
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
