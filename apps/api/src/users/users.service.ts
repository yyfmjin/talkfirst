import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { NotificationService } from "../notifications/notification.service";
import { PrismaService } from "../prisma/prisma.service";
import { normalizeUploadUrl } from "../uploads/upload-url";
import { isProfileComplete } from "./profile-completion";
import {
  filterAttributesForViewer,
  groupAttributeViews,
  toAttributeViews,
  type AttributeGroups,
  type UserAttributeRecord,
} from "./profile-attributes.view";
import {
  canViewField,
  resolveFieldVisibilityMap,
  type ProfileVisibilityField,
} from "./profile-visibility.constants";

export type PublicProfile = {
  id: string;
  nickname: string | null;
  avatarUrl: string | null;
  age: number | null;
  countryCode: string | null;
  countryName: string | null;
  countryFlag: string | null;
  city: string | null;
  region: string | null;
  // PC-1.3: `gender` is now governed by ProfileFieldVisibility, so a viewer who
  // may not see it receives null instead of the raw value.
  gender: string | null;
  bio: string | null;
  languages: Array<{ code: string; name: string; nativeName: string | null; type: string; level: string }>;
  interests: Array<{ slug: string; name: string; nameZh: string | null; category: string }>;
  purposes: Array<{ slug: string; name: string; nameZh: string | null }>;
  preferredCountries: Array<{ code: string; name: string; flag: string | null }>;
  attributes: AttributeGroups;
  relationship: { isSelf: boolean; isConnected: boolean };
  /**
   * 送花（虚拟礼物，2026-10-06）。
   *
   * `flowerCount` 是**收到的朵数**（多少人给过）—— 与动态的点赞数同一性质，
   * 对能看到这份资料的人公开。它目前不受逐字段可见范围控制（那套字段表里没有它）；
   * 如果以后要能隐藏，就得在 `ProfileFieldVisibility` 里增一个字段再加开关。
   * `flowerFromViewer` 只用于渲染按钮状态，不泄露「还有谁也送过」。
   */
  flowerCount: number;
  flowerFromViewer: boolean;
};

export type PublicCard = {
  id: string;
  email: string;
  emailVerified: boolean;
  nickname: string | null;
  avatarUrl: string | null;
  birthDate: unknown;
  countryCode: string | null;
  city: string | null;
  region: string | null;
  gender: string;
  bio: string | null;
  isAdmin: boolean;
  status: string;
  languages: Array<{ code: string; name: string; nativeName: string | null; type: string; level: string }>;
  interests: Array<{ slug: string; name: string; nameZh: string | null; category: string }>;
  purposes: Array<{ slug: string; name: string; nameZh: string | null }>;
  preferredCountries: Array<{ code: string; name: string; flag: string | null }>;
  attributes: AttributeGroups;
  profileCompleted: boolean;
};

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    /** PC-3.1b —— 通知只有这一个写入点，送花走它（NotificationModule 是 @Global）。 */
    private readonly notifications: NotificationService,
  ) {}

  async getFullCard(userId: string): Promise<PublicCard> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        languages: { include: { language: true } },
        interests: { include: { interest: true } },
        purposes: { include: { purpose: true } },
        preferredCountries: { include: { country: true } },
        attributes: {
          include: { definition: true },
          orderBy: [{ kind: "asc" }, { sortOrder: "asc" }],
        },
      },
    });
    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }
    return {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl,
      birthDate: user.birthDate,
      countryCode: user.countryCode,
      city: user.city,
      region: user.region,
      gender: user.gender,
      bio: user.bio,
      isAdmin: user.isAdmin,
      status: user.status,
      languages: user.languages.map((row) => ({
        code: row.languageCode,
        name: row.language.name,
        nativeName: row.language.nativeName,
        type: row.type,
        level: row.level,
      })),
      interests: user.interests.map((row) => ({
        slug: row.interest.slug,
        name: row.interest.name,
        nameZh: row.interest.nameZh,
        category: row.interest.category,
      })),
      purposes: user.purposes.map((row) => ({
        slug: row.purpose.slug,
        name: row.purpose.name,
        nameZh: row.purpose.nameZh,
      })),
      preferredCountries: user.preferredCountries.map((row) => ({
        code: row.countryCode,
        name: row.country.name,
        flag: row.country.flag,
      })),
      attributes: groupAttributeViews(toAttributeViews(user.attributes as UserAttributeRecord[])),
      profileCompleted: isProfileComplete(user),
    };
  }

  async getPublicProfile(targetId: string, viewerId: string): Promise<PublicProfile> {
    const isSelf = targetId === viewerId;

    const user = await this.prisma.user.findUnique({
      where: { id: targetId },
      include: {
        languages: { include: { language: true } },
        interests: { include: { interest: true } },
        purposes: { include: { purpose: true } },
        preferredCountries: { include: { country: true } },
        attributes: {
          include: { definition: true },
          orderBy: [{ kind: "asc" }, { sortOrder: "asc" }],
        },
        fieldVisibilities: { select: { fieldKey: true, visibility: true } },
      },
    });
    if (!user || (!isSelf && user.status !== "ACTIVE")) {
      throw new NotFoundException({
        success: false,
        error: { code: "USER_NOT_FOUND", message: "User not found" },
      });
    }

    if (!isSelf) {
      const blocked = await this.prisma.block.findFirst({
        where: {
          OR: [
            { blockerId: viewerId, blockedId: targetId },
            { blockerId: targetId, blockedId: viewerId },
          ],
        },
      });
      if (blocked) {
        throw new ForbiddenException({
          success: false,
          error: { code: "BLOCKED", message: "This profile is unavailable" },
        });
      }
    }

    const [connection, country, flower] = await Promise.all([
      isSelf
        ? null
        : this.prisma.connection.findFirst({
            where: {
              status: "ACTIVE",
              OR: [
                { userAId: viewerId, userBId: targetId },
                { userAId: targetId, userBId: viewerId },
              ],
            },
            select: { id: true },
          }),
      user.countryCode ? this.prisma.country.findUnique({ where: { code: user.countryCode } }) : null,
      // 看自己的人不必查（按钮不显示）—— 少一次查询，也没有「给自己送花」这种状态。
      isSelf
        ? null
        : this.prisma.userFlower.findUnique({
            where: { senderId_receiverId: { senderId: viewerId, receiverId: targetId } },
            select: { senderId: true },
          }),
    ]);

    // PC-1.3: the block check above has already run, so "Block > visibility"
    // holds by construction — a blocked viewer never reaches this projection.
    const viewer = { isSelf, isConnected: Boolean(connection) };
    const fieldVisibility = resolveFieldVisibilityMap(user.fieldVisibilities ?? []);
    const canSee = (field: ProfileVisibilityField) => canViewField(fieldVisibility[field], viewer);

    return {
      id: user.id,
      nickname: canSee("nickname") ? user.nickname : null,
      avatarUrl: canSee("avatarUrl") ? user.avatarUrl : null,
      age: canSee("birthDate") ? this.calculateAge(user.birthDate) : null,
      countryCode: canSee("countryCode") ? user.countryCode : null,
      countryName: canSee("countryCode") ? country?.name ?? null : null,
      countryFlag: canSee("countryCode") ? country?.flag ?? null : null,
      city: canSee("city") ? user.city : null,
      region: canSee("region") ? user.region : null,
      gender: canSee("gender") ? user.gender : null,
      bio: canSee("bio") ? user.bio : null,
      languages: canSee("languages")
        ? user.languages.map((row) => ({
            code: row.languageCode,
            name: row.language.name,
            nativeName: row.language.nativeName,
            type: row.type,
            level: row.level,
          }))
        : [],
      interests: canSee("interests")
        ? user.interests.map((row) => ({
            slug: row.interest.slug,
            name: row.interest.name,
            nameZh: row.interest.nameZh,
            category: row.interest.category,
          }))
        : [],
      purposes: canSee("purposes")
        ? user.purposes.map((row) => ({
            slug: row.purpose.slug,
            name: row.purpose.name,
            nameZh: row.purpose.nameZh,
          }))
        : [],
      preferredCountries: canSee("preferredCountries")
        ? user.preferredCountries.map((row) => ({
            code: row.countryCode,
            name: row.country.name,
            flag: row.country.flag,
          }))
        : [],
      attributes: canSee("attributes")
        ? filterAttributesForViewer(user.attributes as UserAttributeRecord[], viewer)
        : { aboutMe: [], lookingFor: [] },
      relationship: { isSelf, isConnected: Boolean(connection) },
      // 计数来自 `User.flowerCount`（与 `Moment.likeCount` 同一取向：读时不聚合）。
      flowerCount: Math.max(0, user.flowerCount),
      flowerFromViewer: Boolean(flower),
    };
  }

  /**
   * 送花 / 收回（点赞式的一次性动作，2026-10-06）。
   *
   * ## 守卫刻意与 `getPublicProfile` 用同一套判断
   *
   *   · 目标不存在或非 ACTIVE → 返回 `null`（控制器转 404）
   *   · 给自己送 → 招 `FLOWER_SELF`（控制器转 400）
   *   · 任一方拉黑 → 招 `BLOCKED`（控制器转 403）
   *
   * 不另写一份「宽松版」的理由：送花会给对方产生**可见的后果**（计数 + 通知），
   * 一旦这里比资料页宽松，它就成了一条绕过拉黑与可见性的旁路。
   *
   * ## 为什么用事务
   *
   * 花的行与 `flowerCount` 必须一起变：只插入行而计数未加，资料页会显示少一朵；
   * 反过来则会凭空多出一朵。与 `toggleLike` 同一理由。
   */
  async toggleFlower(senderId: string, receiverId: string) {
    if (senderId === receiverId) {
      throw new BadRequestException({
        success: false,
        error: { code: "FLOWER_SELF", message: "You cannot send flowers to yourself" },
      });
    }

    const receiver = await this.prisma.user.findUnique({
      where: { id: receiverId },
      select: { id: true, status: true },
    });
    if (!receiver || receiver.status !== "ACTIVE") return null;

    const blocked = await this.prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: senderId, blockedId: receiverId },
          { blockerId: receiverId, blockedId: senderId },
        ],
      },
      select: { blockerId: true },
    });
    if (blocked) {
      throw new ForbiddenException({
        success: false,
        error: { code: "BLOCKED", message: "This profile is unavailable" },
      });
    }

    const key = { senderId_receiverId: { senderId, receiverId } };
    const existing = await this.prisma.userFlower.findUnique({ where: key, select: { senderId: true } });

    if (existing) {
      const [, updated] = await this.prisma.$transaction([
        this.prisma.userFlower.delete({ where: key }),
        this.prisma.user.update({
          where: { id: receiverId },
          data: { flowerCount: { decrement: 1 } },
          select: { flowerCount: true },
        }),
      ]);
      // 夹到 0：计数是冗余值，万一历史上有过一次漂移，不能因为收回一朵花
      // 就让资料页显示「-1 朵」。
      return { sent: false, flowerCount: Math.max(0, updated.flowerCount) };
    }

    const [, updated] = await this.prisma.$transaction([
      this.prisma.userFlower.create({ data: { senderId, receiverId } }),
      this.prisma.user.update({
        where: { id: receiverId },
        data: { flowerCount: { increment: 1 } },
        select: { flowerCount: true },
      }),
    ]);

    // 通知写在事务**之后**：一条送花的成功不应因为通知表的问题而回滚（与点赞同一取向）。
    await this.notifications.notify({
      userId: receiverId,
      type: "FLOWER_RECEIVED",
      title: "你收到了一朵花",
      data: { actorId: senderId, targetType: "USER", targetId: senderId },
    });

    return { sent: true, flowerCount: updated.flowerCount };
  }

  private calculateAge(birthDate: Date | null): number | null {
    if (!birthDate) return null;
    const now = new Date();
    let age = now.getFullYear() - birthDate.getFullYear();
    const month = now.getMonth() - birthDate.getMonth();
    if (month < 0 || (month === 0 && now.getDate() < birthDate.getDate())) age -= 1;
    return age;
  }

  async updateProfile(
    userId: string,
    dto: {
      nickname?: string;
      birthDate?: string;
      countryCode?: string;
      city?: string;
      region?: string;
      gender?: "UNKNOWN" | "MALE" | "FEMALE" | "OTHER";
      bio?: string;
    },
  ) {
    // PC-1.3 22: `region` is normalized to null when blank. `undefined` still
    // means "leave unchanged", so PATCH stays partial.
    const region =
      dto.region === undefined ? undefined : dto.region.normalize("NFKC").trim() || null;

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        nickname: dto.nickname,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
        countryCode: dto.countryCode ? dto.countryCode.toUpperCase() : undefined,
        city: dto.city,
        region,
        gender: dto.gender,
        bio: dto.bio,
      },
    });
    return this.getFullCard(user.id);
  }

  async updateAvatar(userId: string, avatarUrl: string) {
    const normalized = normalizeUploadUrl(avatarUrl);
    if (!normalized) {
      const error = new Error("INVALID_IMAGE") as Error & { code?: string };
      error.code = "INVALID_IMAGE";
      throw error;
    }
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: normalized },
    });
    return this.getFullCard(user.id);
  }

  /**
   * Replace the caller's language list.
   *
   * SEC/DATA FIX: this used to be `deleteMany()` followed by a bare
   * `createMany()`, in two autocommit statements. `UserLanguage` is unique on
   * `(userId, languageCode, type)`, while the pre-check only compared
   * *distinct codes* — so a payload such as
   *   [{ code: "en", type: "NATIVE" }, { code: "en", type: "LEARNING" }]
   * passed validation, the `createMany` then violated the unique index, and the
   * already-committed `deleteMany` had wiped every language the user had. The
   * controller's `catch {}` additionally reported that as
   * `UNKNOWN_LANGUAGE_CODE`, so the failure looked like bad input while the data
   * was gone.
   *
   * Two independent guards now:
   *  1. the payload is de-duplicated on the real uniqueness key `(code, type)`
   *     (same code with a different `type` is legitimate and stays), and
   *  2. the delete + insert pair runs inside one transaction, so a failure can
   *     never leave the list empty.
   */
  async replaceLanguages(
    userId: string,
    items: Array<{
      code: string;
      type: "NATIVE" | "LEARNING";
      level?: "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | "NATIVE";
    }>,
  ) {
    const deduped = new Map<
      string,
      { code: string; type: "NATIVE" | "LEARNING"; level?: "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | "NATIVE" }
    >();
    for (const item of items) {
      const code = item.code.trim().toLowerCase();
      deduped.set(`${code}:${item.type}`, { ...item, code });
    }
    const rows = [...deduped.values()];

    const codes = [...new Set(rows.map((item) => item.code))];
    const known = await this.prisma.language.findMany({ where: { code: { in: codes } } });
    if (known.length !== codes.length) {
      throw new Error("UNKNOWN_LANGUAGE_CODE");
    }

    await this.prisma.$transaction([
      this.prisma.userLanguage.deleteMany({ where: { userId } }),
      this.prisma.userLanguage.createMany({
        data: rows.map((item) => ({
          userId,
          languageCode: item.code,
          type: item.type,
          level: item.level ?? (item.type === "NATIVE" ? "NATIVE" : "INTERMEDIATE"),
        })),
      }),
    ]);
    return this.getFullCard(userId);
  }

  /** See `replaceLanguages` — de-duplicated on the real key, and atomic. */
  async replaceInterests(userId: string, slugs: string[]) {
    const unique = [...new Set(slugs)];
    const interests = await this.prisma.interest.findMany({ where: { slug: { in: unique } } });
    if (interests.length !== unique.length) {
      throw new Error("UNKNOWN_INTEREST_SLUG");
    }
    await this.prisma.$transaction([
      this.prisma.userInterest.deleteMany({ where: { userId } }),
      this.prisma.userInterest.createMany({
        data: interests.map((interest) => ({ userId, interestId: interest.id })),
      }),
    ]);
    return this.getFullCard(userId);
  }

  /** See `replaceLanguages` — de-duplicated on the real key, and atomic. */
  async replacePurposes(userId: string, slugs: string[]) {
    const unique = [...new Set(slugs)];
    const purposes = await this.prisma.purpose.findMany({ where: { slug: { in: unique } } });
    if (purposes.length !== unique.length) {
      throw new Error("UNKNOWN_PURPOSE_SLUG");
    }
    await this.prisma.$transaction([
      this.prisma.userPurpose.deleteMany({ where: { userId } }),
      this.prisma.userPurpose.createMany({
        data: purposes.map((purpose) => ({ userId, purposeId: purpose.id })),
      }),
    ]);
    return this.getFullCard(userId);
  }

  /** See `replaceLanguages` — de-duplicated on the real key, and atomic. */
  async replacePreferredCountries(userId: string, codes: string[]) {
    const normalized = [...new Set(codes.map((code) => code.trim().toUpperCase()))];
    if (normalized.length > 0) {
      const known = await this.prisma.country.findMany({ where: { code: { in: normalized } } });
      if (known.length !== normalized.length) {
        throw new Error("UNKNOWN_COUNTRY_CODE");
      }
    }
    await this.prisma.$transaction([
      this.prisma.userPreferredCountry.deleteMany({ where: { userId } }),
      this.prisma.userPreferredCountry.createMany({
        data: normalized.map((countryCode) => ({ userId, countryCode })),
      }),
    ]);
    return this.getFullCard(userId);
  }
}
