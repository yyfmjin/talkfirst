import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * PC-1.4 browser-test fixtures.
 *
 * The profile screens are only meaningful against a real API and a real
 * database, so the suite seeds its own accounts. Everything is keyed on a
 * `pw.pc14.` email prefix and is created idempotently — `cleanup()` removes
 * exactly those rows and nothing else.
 *
 * The three accounts model the three viewers the visibility rules care about:
 *
 *   alice — the profile under inspection. Owns a PUBLIC tag, a CONNECTIONS-only
 *           tag, a CONNECTIONS bio and a PRIVATE city.
 *   bob   — connected to alice, so he must see the CONNECTIONS tier.
 *   carol — a stranger, so she must see neither CONNECTIONS nor PRIVATE.
 */

export const PASSWORD = "Pc14Web!2026";

export const EMAILS = {
  alice: "pw.pc14.alice@example.test",
  bob: "pw.pc14.bob@example.test",
  carol: "pw.pc14.carol@example.test",
} as const;

export type FixtureKey = keyof typeof EMAILS;
export type FixtureIds = Record<FixtureKey, string>;

export const FIXTURE_EMAILS: string[] = Object.values(EMAILS);

export const ALICE_NICKNAME = "PW 爱丽丝";
export const BOB_NICKNAME = "PW 鲍勃";
export const CAROL_NICKNAME = "PW 卡罗尔";

/** Alice's CONNECTIONS-tier bio: Bob sees it, Carol must not. */
export const ALICE_BIO = "PW Alice 仅连接可见的简介";
/** Alice's PRIVATE city: nobody but Alice sees it. */
export const ALICE_CITY = "Tokyo";
/** Alice's PUBLIC region: the control that stays visible to everyone. */
export const ALICE_REGION = "Kanto";
/** Alice's CONNECTIONS-tier custom tag: Bob sees it, Carol must not. */
export const ALICE_CONNECTIONS_ATTRIBUTE = "Coffee Buddy";
/** Alice's PUBLIC system tag. */
export const ALICE_PUBLIC_ATTRIBUTE = "City Pop";
/** Alice's PUBLIC custom tag — the one the editor test renames / hides. */
export const ALICE_CUSTOM_ATTRIBUTE = "Slow Warmup Test";
export const BOB_MOMENT_TEXT = "PW PC-1.4 fixture moment";
export const ALICE_COMMENT_TEXT = "PW fixture comment";

type Account = {
  email: string;
  nickname: string;
  countryCode: string;
  city: string;
  region: string | null;
  birthDate: string;
  gender: "MALE" | "FEMALE" | "OTHER" | "UNKNOWN";
  bio: string;
  languages: Array<{ code: string; type: "NATIVE" | "LEARNING"; level: string }>;
  interests: string[];
  purposes: string[];
};

const ACCOUNTS: Record<FixtureKey, Account> = {
  alice: {
    email: EMAILS.alice,
    nickname: ALICE_NICKNAME,
    countryCode: "JP",
    city: ALICE_CITY,
    region: ALICE_REGION,
    birthDate: "1996-04-12",
    gender: "FEMALE",
    bio: ALICE_BIO,
    languages: [
      { code: "zh", type: "NATIVE", level: "NATIVE" },
      { code: "en", type: "LEARNING", level: "INTERMEDIATE" },
    ],
    interests: ["pop", "photography", "anime"],
    purposes: ["language-exchange"],
  },
  bob: {
    email: EMAILS.bob,
    nickname: BOB_NICKNAME,
    countryCode: "US",
    city: "Austin",
    region: "Texas",
    birthDate: "1994-09-03",
    gender: "MALE",
    bio: "PW Bob bio",
    languages: [
      { code: "en", type: "NATIVE", level: "NATIVE" },
      { code: "zh", type: "LEARNING", level: "BEGINNER" },
    ],
    interests: ["minecraft", "steam", "gta"],
    purposes: ["gaming"],
  },
  carol: {
    email: EMAILS.carol,
    nickname: CAROL_NICKNAME,
    countryCode: "FR",
    city: "Lyon",
    region: null,
    birthDate: "1998-01-27",
    gender: "FEMALE",
    bio: "PW Carol bio",
    languages: [
      { code: "en", type: "NATIVE", level: "NATIVE" },
      { code: "zh", type: "LEARNING", level: "INTERMEDIATE" },
    ],
    interests: ["travel-jp", "travel-kr", "culture"],
    purposes: ["making-friends"],
  },
};

/** Removes every row this suite may have created for the fixture accounts. */
export async function cleanup(prisma: PrismaClient): Promise<number> {
  const users = await prisma.user.findMany({
    where: { email: { in: FIXTURE_EMAILS } },
    select: { id: true },
  });
  const ids = users.map((user) => user.id);
  if (ids.length === 0) return 0;

  // Comments written by a fixture account on someone else's moment do not
  // cascade from the moment, so they are cleared explicitly.
  await prisma.momentComment.deleteMany({
    where: { OR: [{ userId: { in: ids } }, { moment: { userId: { in: ids } } }] },
  });
  await prisma.momentLike.deleteMany({ where: { userId: { in: ids } } });
  await prisma.moment.deleteMany({ where: { userId: { in: ids } } });
  await prisma.momentSetting.deleteMany({ where: { userId: { in: ids } } });
  await prisma.discoverView.deleteMany({
    where: { OR: [{ userId: { in: ids } }, { viewedUserId: { in: ids } }] },
  });
  await prisma.report.deleteMany({
    where: { OR: [{ reporterId: { in: ids } }, { reportedUserId: { in: ids } }] },
  });
  await prisma.block.deleteMany({
    where: { OR: [{ blockerId: { in: ids } }, { blockedId: { in: ids } }] },
  });
  await prisma.connection.deleteMany({
    where: { OR: [{ userAId: { in: ids } }, { userBId: { in: ids } }] },
  });
  await prisma.userAttribute.deleteMany({ where: { userId: { in: ids } } });
  await prisma.profileFieldVisibility.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userLanguage.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userInterest.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userPurpose.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userPreferredCountry.deleteMany({ where: { userId: { in: ids } } });

  const removed = await prisma.user.deleteMany({ where: { id: { in: ids } } });
  return removed.count;
}

export async function seed(prisma: PrismaClient): Promise<FixtureIds> {
  // Start from a clean slate so a crashed previous run cannot leave a stale
  // attribute or visibility row behind and silently change what a test proves.
  await cleanup(prisma);

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const ids = {} as FixtureIds;

  for (const key of Object.keys(ACCOUNTS) as FixtureKey[]) {
    const account = ACCOUNTS[key];
    const user = await prisma.user.create({
      data: {
        email: account.email,
        // P0-02 — required and unique. Derived from the fixture's own address so
        // it is stable across runs and unique per account without another table of
        // literals to keep in step.
        username: `prof${account.email.split("@")[0].replace(/[^a-z0-9]/g, "")}`,
        passwordHash,
        emailVerified: true,
        status: "ACTIVE",
        nickname: account.nickname,
        countryCode: account.countryCode,
        city: account.city,
        region: account.region,
        birthDate: new Date(`${account.birthDate}T00:00:00.000Z`),
        gender: account.gender,
        bio: account.bio,
      },
      select: { id: true },
    });
    ids[key] = user.id;

    await prisma.userLanguage.createMany({
      data: account.languages.map((item) => ({
        userId: user.id,
        languageCode: item.code,
        type: item.type,
        level: item.level as never,
      })),
    });

    const interests = await prisma.interest.findMany({ where: { slug: { in: account.interests } } });
    await prisma.userInterest.createMany({
      data: interests.map((interest) => ({ userId: user.id, interestId: interest.id })),
    });

    const purposes = await prisma.purpose.findMany({ where: { slug: { in: account.purposes } } });
    await prisma.userPurpose.createMany({
      data: purposes.map((purpose) => ({ userId: user.id, purposeId: purpose.id })),
    });
  }

  // An ACTIVE connection is what makes the CONNECTIONS tier real for Bob.
  await prisma.connection.create({
    data: { userAId: ids.alice, userBId: ids.bob, status: "ACTIVE" },
  });

  const definitions = await prisma.attributeDefinition.findMany({
    where: { key: { in: ["about-city-pop", "looking-language-exchange"] } },
    select: { id: true, key: true },
  });
  const publicTag = definitions.find((row) => row.key === "about-city-pop");
  const lookingTag = definitions.find((row) => row.key === "looking-language-exchange");
  if (!publicTag || !lookingTag) {
    throw new Error("PC-1.4 fixtures need the system attribute definitions — run `npx tsx prisma/seed.ts`");
  }

  await prisma.userAttribute.createMany({
    data: [
      {
        userId: ids.alice,
        kind: "ABOUT_ME",
        definitionId: publicTag.id,
        visibility: "PUBLIC",
        sortOrder: 0,
      },
      {
        userId: ids.alice,
        kind: "ABOUT_ME",
        label: ALICE_CUSTOM_ATTRIBUTE,
        labelKey: ALICE_CUSTOM_ATTRIBUTE.toLowerCase(),
        value: "slow starter",
        visibility: "PUBLIC",
        sortOrder: 1,
      },
      {
        userId: ids.alice,
        kind: "LOOKING_FOR",
        definitionId: lookingTag.id,
        visibility: "PUBLIC",
        sortOrder: 0,
      },
      {
        userId: ids.alice,
        kind: "LOOKING_FOR",
        label: ALICE_CONNECTIONS_ATTRIBUTE,
        labelKey: ALICE_CONNECTIONS_ATTRIBUTE.toLowerCase(),
        visibility: "CONNECTIONS",
        sortOrder: 1,
      },
    ],
  });

  // Only the fields the visibility tests actually assert on get a row; every
  // other field stays at the implicit PUBLIC default (lazy rows, PC-1.1 Q5).
  await prisma.profileFieldVisibility.createMany({
    data: [
      { userId: ids.alice, fieldKey: "bio", visibility: "CONNECTIONS" },
      { userId: ids.alice, fieldKey: "city", visibility: "PRIVATE" },
      { userId: ids.alice, fieldKey: "gender", visibility: "PRIVATE" },
    ],
  });

  // Bob's own moment gives the Moments feed a deterministic card to click, and
  // Alice's comment on it gives the comment-avatar test a deterministic target.
  const moment = await prisma.moment.create({
    data: {
      userId: ids.bob,
      platform: "TALKFIRST",
      content: BOB_MOMENT_TEXT,
      source: "USER",
    },
    select: { id: true },
  });
  await prisma.momentComment.create({
    data: { momentId: moment.id, userId: ids.alice, content: ALICE_COMMENT_TEXT },
  });
  await prisma.moment.update({
    where: { id: moment.id },
    data: { commentCount: 1 },
  });

  return ids;
}

/**
 * Reads the fixture account ids back from the database.
 *
 * A spec that needs `/profile/<id>` cannot hard-code a uuid — they are generated
 * per run — so it resolves them once instead.
 */
export async function resolveFixtureIds(): Promise<FixtureIds> {
  const prisma = new PrismaClient();
  try {
    const users = await prisma.user.findMany({
      where: { email: { in: FIXTURE_EMAILS } },
      select: { id: true, email: true },
    });
    const ids = {} as FixtureIds;
    for (const key of Object.keys(EMAILS) as FixtureKey[]) {
      const found = users.find((user) => user.email === EMAILS[key]);
      if (!found) throw new Error(`PC-1.4 fixture account missing: ${EMAILS[key]}`);
      ids[key] = found.id;
    }
    return ids;
  } finally {
    await prisma.$disconnect();
  }
}
