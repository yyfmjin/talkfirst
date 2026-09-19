/**
 * Docker runtime seed.
 *
 * This is a plain-JS mirror of `prisma/seed.ts` with the TypeScript types
 * stripped. It exists because the API runtime image installs with
 * `npm ci --omit=dev`, so `tsx` (a devDependency) is not available there.
 *
 * Keep this file in sync with `prisma/seed.ts` when seed data changes.
 * Behaviour, ordering, and the `SEED_OK` / exit-code contract are identical.
 */
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

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
  { slug: "travel", name: "Travel Together", nameZh: "旅行结伴", sort: 4 },
  { slug: "culture", name: "Culture Exchange", nameZh: "文化交流", sort: 5 },
];

const LANGUAGES = [
  { code: "zh", name: "Chinese", nameZh: "中文" },
  { code: "en", name: "English", nameZh: "英语" },
  { code: "ja", name: "Japanese", nameZh: "日语" },
  { code: "ko", name: "Korean", nameZh: "韩语" },
  { code: "es", name: "Spanish", nameZh: "西班牙语" },
  { code: "fr", name: "French", nameZh: "法语" },
  { code: "de", name: "German", nameZh: "德语" },
];

const COUNTRIES = [
  { code: "CN", name: "China", nameZh: "中国" },
  { code: "JP", name: "Japan", nameZh: "日本" },
  { code: "KR", name: "South Korea", nameZh: "韩国" },
  { code: "US", name: "United States", nameZh: "美国" },
  { code: "GB", name: "United Kingdom", nameZh: "英国" },
  { code: "DE", name: "Germany", nameZh: "德国" },
  { code: "FR", name: "France", nameZh: "法国" },
  { code: "ES", name: "Spain", nameZh: "西班牙" },
  { code: "TH", name: "Thailand", nameZh: "泰国" },
  { code: "SG", name: "Singapore", nameZh: "新加坡" },
];

async function main() {
  for (const item of INTERESTS) {
    await prisma.interest.upsert({
      where: { slug: item.slug },
      update: { name: item.name, nameZh: item.nameZh, category: item.category, sort: item.sort },
      create: item,
    });
  }
  console.log(`seeded interests=${INTERESTS.length}`);

  for (const item of PURPOSES) {
    await prisma.purpose.upsert({
      where: { slug: item.slug },
      update: { name: item.name, nameZh: item.nameZh, sort: item.sort },
      create: item,
    });
  }
  console.log(`seeded purposes=${PURPOSES.length}`);

  for (const item of LANGUAGES) {
    await prisma.language.upsert({
      where: { code: item.code },
      update: { name: item.name, nameZh: item.nameZh },
      create: item,
    });
  }
  console.log(`seeded languages=${LANGUAGES.length}`);

  for (const item of COUNTRIES) {
    await prisma.country.upsert({
      where: { code: item.code },
      update: { name: item.name, nameZh: item.nameZh },
      create: item,
    });
  }
  console.log(`seeded countries=${COUNTRIES.length}`);

  const bootstrapAdmin = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
  if (bootstrapAdmin) {
    await prisma.user.updateMany({
      where: { email: bootstrapAdmin },
      data: { isAdmin: true, status: "ACTIVE" },
    });
  }
  const adminCount = await prisma.user.count({ where: { isAdmin: true } });
  console.log(`SEED_OK phase=docker admins=${adminCount}`);
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
