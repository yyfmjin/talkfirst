import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { canViewField, resolveFieldVisibilityMap, type ProfileVisibilityField } from "../users/profile-visibility.constants";
import { isProfileComplete } from "../users/profile-completion";
import { DAILY_VIEW_LIMIT } from "../discover/discover.service";

/** 一道题的有效期：10 分钟。过期作废，且不扣次数。 */
const ROUND_TTL_MS = 10 * 60 * 1000;
/** 同一查看者对同一目标 7 天内不重复出题。 */
const REPEAT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** 统计样本太小时不展示命中率（避免小样本暴露）。 */
const MIN_STAT_SAMPLE = 5;
/** 一次取多少候选再过滤，够挑一个即可；不扫全表。 */
const CANDIDATE_SCAN = 60;
/** 头像清晰度门槛：真人头像的短边要求，挡住缩略图/表情包。 */
const MIN_AVATAR_EDGE = 400;

/**
 * 同区域国家表 —— 干扰项只从这里取。
 *
 * 为什么要分区域：如果另外两个选项从全球随机抽，用户一眼就能排除（比如答案是日本，
 * 选项里出现巴西和尼日利亚），题目就没有信息量了。同区域里选，才需要真的看脸/看线索。
 *
 * 只列常见来源国；没收录的国家退回「全球随机」并仍然排除正确答案。
 */
const COUNTRY_REGION: Record<string, string> = {
  CN: "ASIA", JP: "ASIA", KR: "ASIA", TW: "ASIA", HK: "ASIA", MO: "ASIA",
  TH: "ASIA", VN: "ASIA", PH: "ASIA", ID: "ASIA", MY: "ASIA", SG: "ASIA",
  IN: "ASIA", PK: "ASIA", BD: "ASIA", LK: "ASIA", NP: "ASIA", KH: "ASIA",
  MM: "ASIA", LA: "ASIA", MN: "ASIA", KZ: "ASIA", UZ: "ASIA",
  GB: "EUROPE", IE: "EUROPE", FR: "EUROPE", DE: "EUROPE", NL: "EUROPE",
  BE: "EUROPE", CH: "EUROPE", AT: "EUROPE", IT: "EUROPE", ES: "EUROPE",
  PT: "EUROPE", PL: "EUROPE", CZ: "EUROPE", SK: "EUROPE", HU: "EUROPE",
  RO: "EUROPE", BG: "EUROPE", GR: "EUROPE", SE: "EUROPE", NO: "EUROPE",
  DK: "EUROPE", FI: "EUROPE", RU: "EUROPE", UA: "EUROPE", TR: "EUROPE",
  US: "AMERICAS", CA: "AMERICAS", MX: "AMERICAS", BR: "AMERICAS", AR: "AMERICAS",
  CL: "AMERICAS", CO: "AMERICAS", PE: "AMERICAS", VE: "AMERICAS", UY: "AMERICAS",
  EC: "AMERICAS", BO: "AMERICAS", PY: "AMERICAS", CR: "AMERICAS", CU: "AMERICAS",
  EG: "AFRICA", MA: "AFRICA", DZ: "AFRICA", TN: "AFRICA", NG: "AFRICA",
  GH: "AFRICA", KE: "AFRICA", ET: "AFRICA", ZA: "AFRICA", TZ: "AFRICA",
  UG: "AFRICA", SN: "AFRICA", CI: "AFRICA", CM: "AFRICA",
  AU: "OCEANIA", NZ: "OCEANIA", FJ: "OCEANIA", PG: "OCEANIA",
};

type CountryRow = { code: string; name: string; flag: string | null };

/**
 * 「猜猜看」的服务端（2026-10-25）。
 *
 * 三条不可动摇的规则：
 * 1. **正确答案只存在服务端**。`nextRound` 只下发打乱后的 3 个候选，
 *    `correctCode` 永不出现在任何响应里，直到用户答完。
 * 2. **一次猜 = 看了一张照片**，所以和发现页共用同一个每日 20 次额度
 *    （`DiscoverView` 计数），不另起一套数字。
 * 3. **被猜统计只加在被猜者身上**，且同一对（猜的人、被猜的人）只计一次，
 *    否则一个人可以靠反复猜同一个人把对方的正确率刷成任意值。
 */
@Injectable()
export class GuessService {
  constructor(private readonly prisma: PrismaService) {}

  /** 今天还能猜几次 —— 与发现页同一个数字。 */
  async remainingFor(viewerId: string) {
    const used = await this.prisma.discoverView.count({
      where: { userId: viewerId, viewDate: startOfUtcDay() },
    });
    return Math.max(DAILY_VIEW_LIMIT - used, 0);
  }

  async nextRound(viewerId: string) {
    const remaining = await this.remainingFor(viewerId);
    if (remaining <= 0) {
      throw new HttpException(
        { success: false, error: { code: "NO_QUOTA", message: "Daily limit reached" } },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const target = await this.pickTarget(viewerId);
    if (!target) {
      /*
       * 两种「没人可猜」要分开（2026-10-25）：
       *   NO_CANDIDATE       池子本身是空的 —— 这时候说「晚点再来」是敷衍，
       *                      该引导用户去邀请朋友 / 报名当题目；
       *   NO_CANDIDATE_LEFT  池子里有人，但你 7 天内都猜过了 —— 明天再来。
       */
      const poolSize = await this.prisma.user.count({ where: this.poolWhere() });
      const code = poolSize === 0 ? "NO_CANDIDATE" : "NO_CANDIDATE_LEFT";
      throw new ConflictException({
        success: false,
        error: {
          code,
          message: poolSize === 0 ? "The pool is empty" : "You have guessed everyone available",
        },
      });
    }

    const countries = await this.countryTable();
    const byCode = new Map(countries.map((row) => [row.code, row]));
    const options = this.buildOptions(target.countryCode, countries);

    const round = await this.prisma.countryGuess.create({
      data: {
        viewerId,
        targetId: target.id,
        correctCode: target.countryCode,
        options,
        expiresAt: new Date(Date.now() + ROUND_TTL_MS),
      },
      select: { id: true, expiresAt: true },
    });

    return {
      roundId: round.id,
      photoUrl: target.avatarUrl,
      options: options.map((code) => this.countryPayload(byCode, code)),
      remaining,
      expiresAt: round.expiresAt.toISOString(),
    };
  }

  async answer(viewerId: string, roundId: string, countryCode: string) {
    const round = await this.prisma.countryGuess.findFirst({
      where: { id: roundId, viewerId },
      select: {
        id: true, viewerId: true, targetId: true, correctCode: true,
        options: true, guessedCode: true, correct: true, expiresAt: true,
      },
    });
    if (!round) throw new NotFoundException({ success: false, error: { code: "GUESS_NOT_FOUND", message: "Round not found" } });
    if (round.guessedCode && round.correct !== null) {
      return this.buildAnswer(round.viewerId, round.targetId, round.correct, round.correctCode, round.guessedCode);
    }
    if (round.expiresAt.getTime() <= Date.now()) {
      throw new ConflictException({ success: false, error: { code: "GUESS_EXPIRED", message: "Round expired" } });
    }
    if (!round.options.includes(countryCode)) {
      throw new BadRequestException({
        success: false,
        error: { code: "INVALID_OPTION", message: "Country is not one of the options" },
      });
    }

    const correct = countryCode === round.correctCode;
    const firstTimeForPair = (await this.prisma.countryGuess.count({
      where: { viewerId, targetId: round.targetId, guessedCode: { not: null }, id: { not: round.id } },
    })) === 0;

    await this.prisma.$transaction(async (tx) => {
      await tx.countryGuess.update({
        where: { id: round.id },
        data: { guessedCode: countryCode, correct },
      });
      // 一次猜 = 看了一张照片：记一次浏览，消耗同一个每日额度。
      // viewDate 是 date 列，唯一键保证同一天同一人只记一条（重复不叠加）。
      await tx.discoverView.upsert({
        where: {
          userId_viewedUserId_viewDate: { userId: viewerId, viewedUserId: round.targetId, viewDate: startOfUtcDay() },
        },
        create: { userId: viewerId, viewedUserId: round.targetId, viewDate: startOfUtcDay() },
        update: {},
      });
      if (firstTimeForPair) {
        await tx.user.update({
          where: { id: round.targetId },
          data: {
            guessTotal: { increment: 1 },
            ...(correct ? { guessCorrect: { increment: 1 } } : {}),
          },
        });
      }
    });

    return this.buildAnswer(viewerId, round.targetId, correct, round.correctCode, countryCode);
  }

  /**
   * 接受 / 拒绝邀请（2026-10-25 邀请制）。
   *
   * 接受 → `guessOptIn = true`，进题库；拒绝 → 记录时间，**不出题**，也不会再被同一批
   * 邀请打扰（脚本按 `guessInvitedAt` 过滤，已邀请过的不重复推）。
   */
  async respondToInvite(viewerId: string, accept: boolean) {
    const now = new Date();
    const user = await this.prisma.user.update({
      where: { id: viewerId },
      data: accept
        ? { guessOptIn: true, guessInviteAcceptedAt: now, guessInviteDeclinedAt: null }
        : { guessOptIn: false, guessInviteDeclinedAt: now, guessInviteAcceptedAt: null },
      select: { guessOptIn: true, guessInvitedAt: true },
    });
    return { optIn: user.guessOptIn, invitedAt: user.guessInvitedAt };
  }

  /** 随时退出 / 重新加入（不需要再等邀请）。 */
  async updateSettings(viewerId: string, input: { optIn?: boolean; avatarIsRealPhoto?: boolean }) {
    const data: { guessOptIn?: boolean; avatarGuessExcluded?: boolean } = {};
    if (typeof input.optIn === "boolean") data.guessOptIn = input.optIn;
    if (typeof input.avatarIsRealPhoto === "boolean") data.avatarGuessExcluded = !input.avatarIsRealPhoto;
    const user = await this.prisma.user.update({
      where: { id: viewerId },
      data,
      select: { guessOptIn: true, avatarGuessExcluded: true },
    });
    return { optIn: user.guessOptIn, avatarIsRealPhoto: !user.avatarGuessExcluded };
  }

  async settings(viewerId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: viewerId },
      select: {
        guessOptIn: true,
        guessInvitedAt: true,
        guessInviteAcceptedAt: true,
        guessInviteDeclinedAt: true,
        avatarGuessExcluded: true,
        guessTotal: true,
        guessCorrect: true,
      },
    });
    if (!user) throw new NotFoundException({ success: false, error: { code: "USER_NOT_FOUND", message: "User not found" } });
    return {
      optIn: user.guessOptIn,
      invitedAt: user.guessInvitedAt,
      acceptedAt: user.guessInviteAcceptedAt,
      declinedAt: user.guessInviteDeclinedAt,
      avatarIsRealPhoto: !user.avatarGuessExcluded,
      // 「被猜中 N%」只在本人这里返回，不进入任何他人可见的接口。
      stats: user.guessTotal < MIN_STAT_SAMPLE
        ? null
        : { total: user.guessTotal, correct: user.guessCorrect, accuracy: user.guessCorrect / user.guessTotal },
    };
  }

  // ── 内部 ────────────────────────────────────────────────────────────────

  /**
   * 题库的公共条件（不含「这个人对你是否已猜过」）。
   *
   * 出题和「池子是不是空的」必须用同一套判据，否则会出现
   * 「提示说没人可猜，其实池子里有人」这种自相矛盾。
   */
  private poolWhere() {
    return {
      status: "ACTIVE" as const,
      avatarUrl: { not: null },
      countryCode: { not: null },
      guessOptIn: true,
      avatarGuessExcluded: false,
    };
  }

  private async pickTarget(viewerId: string) {
    const excluded = await this.excludedTargetIds(viewerId);
    const rows = await this.prisma.user.findMany({
      where: {
        id: { not: viewerId, ...(excluded.length ? { notIn: excluded } : {}) },
        ...this.poolWhere(),
      },
      select: {
        id: true,
        nickname: true,
        birthDate: true,
        avatarUrl: true,
        avatarWidth: true,
        avatarHeight: true,
        countryCode: true,
        fieldVisibilities: { select: { fieldKey: true, visibility: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: CANDIDATE_SCAN,
    });

    const eligible = rows.filter((row) => this.isEligible(row));
    if (eligible.length === 0) return null;
    const picked = eligible[Math.floor(Math.random() * eligible.length)];
    // isEligible 已经保证两者非空；这里把它变成类型上的事实，免得下游再断言。
    return { ...picked, avatarUrl: picked.avatarUrl as string, countryCode: picked.countryCode as string };
  }

  /**
   * 资格判定（设计文档 §7.5）。
   *
   * 对「陌生人」上下文判定可见性：查看者与被猜者之间没有任何连接，
   * 所以只有 PUBLIC 档的头像/国家才可用 —— 否则游戏会变成绕过隐私设置的读取器。
   */
  private isEligible(row: {
    avatarUrl: string | null;
    countryCode: string | null;
    avatarWidth: number | null;
    avatarHeight: number | null;
    nickname: string | null;
    birthDate: Date | null;
    fieldVisibilities: Array<{ fieldKey: string; visibility: string }>;
  }) {
    if (!row.avatarUrl || !row.countryCode) return false;
    if (!isProfileComplete({ nickname: row.nickname, birthDate: row.birthDate })) return false;

    const visibility = resolveFieldVisibilityMap(
      row.fieldVisibilities.map((entry) => ({
        fieldKey: entry.fieldKey as ProfileVisibilityField,
        visibility: entry.visibility as "PUBLIC" | "CONNECTIONS" | "PRIVATE",
      })),
    );
    const stranger = { isSelf: false, isConnected: false };
    if (!canViewField(visibility.avatarUrl, stranger)) return false;
    if (!canViewField(visibility.countryCode, stranger)) return false;

    // 尺寸未知（历史头像）：按不合格处理 —— 「真人头像」的门槛宁严不宽，
    // 用户重新上传一次即可进入题库。
    if (row.avatarWidth == null || row.avatarHeight == null) return false;
    if (row.avatarWidth < MIN_AVATAR_EDGE || row.avatarHeight < MIN_AVATAR_EDGE) return false;

    return true;
  }

  private async excludedTargetIds(viewerId: string) {
    const since = new Date(Date.now() - REPEAT_WINDOW_MS);
    const [recent, blocks, requests, connections] = await Promise.all([
      /*
       * 只排除「已经答过」的目标（2026-10-25 修正）：跳过不扣次数，也就不该
       * 把对方锁 7 天，否则连点几次「换一个」就能把整个题库锁空。
       */
      this.prisma.countryGuess.findMany({
        where: { viewerId, createdAt: { gte: since }, guessedCode: { not: null } },
        select: { targetId: true },
      }),
      this.prisma.block.findMany({
        where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
        select: { blockerId: true, blockedId: true },
      }),
      /*
       * 只排除「被拒绝」的关系（2026-10-25 修正）。
       *
       * 第一版把「有任何请求记录」的人全排除了，结果题库只有三个人时，
       * 打过一次招呼就把候选清空 —— 猜一个已经跟你打过招呼的人完全没问题。
       * 已接受的关系由下面的 connections 负责，这里只管明确被拒的。
       */
      this.prisma.connectionRequest.findMany({
        where: { status: "REJECTED", OR: [{ senderId: viewerId }, { receiverId: viewerId }] },
        select: { senderId: true, receiverId: true },
      }),
      this.prisma.connection.findMany({
        where: { OR: [{ userAId: viewerId }, { userBId: viewerId }] },
        select: { userAId: true, userBId: true },
      }),
    ]);

    const ids = new Set<string>();
    recent.forEach((row) => ids.add(row.targetId));
    blocks.forEach((row) => {
      ids.add(row.blockerId === viewerId ? row.blockedId : row.blockerId);
    });
    requests.forEach((row) => {
      ids.add(row.senderId === viewerId ? row.receiverId : row.senderId);
    });
    connections.forEach((row) => {
      ids.add(row.userAId === viewerId ? row.userBId : row.userAId);
    });
    ids.delete(viewerId);
    return [...ids];
  }

  /** 三个选项：正确答案 + 两个同区域干扰项，打乱顺序。 */
  buildOptions(answer: string, countries: CountryRow[]) {
    const region = COUNTRY_REGION[answer];
    const sameRegion = countries.filter((row) => row.code !== answer && region && COUNTRY_REGION[row.code] === region);
    const fallback = countries.filter((row) => row.code !== answer && !(region && COUNTRY_REGION[row.code] === region));

    const picked: string[] = [];
    for (const pool of [shuffle(sameRegion), shuffle(fallback)]) {
      for (const row of pool) {
        if (picked.length >= 2) break;
        if (!picked.includes(row.code)) picked.push(row.code);
      }
      if (picked.length >= 2) break;
    }
    return shuffle([answer, ...picked]);
  }

  private async countryTable(): Promise<CountryRow[]> {
    const rows = await this.prisma.country.findMany({ select: { code: true, name: true, flag: true } });
    return rows.map((row) => ({ code: row.code.trim(), name: row.name, flag: row.flag }));
  }

  private countryPayload(byCode: Map<string, CountryRow>, code: string) {
    const row = byCode.get(code);
    return { code, name: row?.name ?? code, flag: row?.flag ?? null };
  }

  private async buildAnswer(
    viewerId: string,
    targetId: string,
    correct: boolean,
    correctCode: string,
    guessedCode: string,
  ) {
    const [target, countries, remaining, helloState] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: targetId }, select: { id: true, nickname: true, guessTotal: true, guessCorrect: true } }),
      this.countryTable(),
      this.remainingFor(viewerId),
      this.helloState(viewerId, targetId),
    ]);
    const byCode = new Map(countries.map((row) => [row.code, row]));
    const total = target?.guessTotal ?? 0;
    const hit = target?.guessCorrect ?? 0;

    return {
      correct,
      guessedCode,
      answer: this.countryPayload(byCode, correctCode),
      target: { id: targetId, nickname: target?.nickname ?? null },
      stat: total < MIN_STAT_SAMPLE ? null : { total, correct: hit, accuracy: hit / total },
      remaining,
      helloState,
    };
  }

  private async helloState(viewerId: string, targetId: string) {
    const connected = await this.prisma.connection.findFirst({
      where: {
        OR: [
          { userAId: viewerId, userBId: targetId },
          { userAId: targetId, userBId: viewerId },
        ],
      },
      select: { id: true },
    });
    if (connected) return "CONNECTED" as const;
    const pending = await this.prisma.connectionRequest.findFirst({
      where: { senderId: viewerId, receiverId: targetId, status: "PENDING" },
      select: { id: true },
    });
    return pending ? ("PENDING" as const) : ("NONE" as const);
  }
}

/**
 * 与 `DiscoverService.startOfToday()` 必须一致 —— 两边数的是同一张
 * `DiscoverView.viewDate`，一天之内的边界不能有两套定义。
 */
function startOfUtcDay() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function shuffle<T>(list: T[]): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
