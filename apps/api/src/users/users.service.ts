import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
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
  constructor(private readonly prisma: PrismaService) {}

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

    const [connection, country] = await Promise.all([
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
    };
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

  async replaceLanguages(
    userId: string,
    items: Array<{
      code: string;
      type: "NATIVE" | "LEARNING";
      level?: "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | "NATIVE";
    }>,
  ) {
    const codes = items.map((item) => item.code.toLowerCase());
    const known = await this.prisma.language.findMany({ where: { code: { in: codes } } });
    if (known.length !== new Set(codes).size) {
      throw new Error("UNKNOWN_LANGUAGE_CODE");
    }
    await this.prisma.userLanguage.deleteMany({ where: { userId } });
    await this.prisma.userLanguage.createMany({
      data: items.map((item) => ({
        userId,
        languageCode: item.code.toLowerCase(),
        type: item.type,
        level: item.level ?? (item.type === "NATIVE" ? "NATIVE" : "INTERMEDIATE"),
      })),
    });
    return this.getFullCard(userId);
  }

  async replaceInterests(userId: string, slugs: string[]) {
    const interests = await this.prisma.interest.findMany({ where: { slug: { in: slugs } } });
    if (interests.length !== new Set(slugs).size) {
      throw new Error("UNKNOWN_INTEREST_SLUG");
    }
    await this.prisma.userInterest.deleteMany({ where: { userId } });
    await this.prisma.userInterest.createMany({
      data: interests.map((interest) => ({ userId, interestId: interest.id })),
    });
    return this.getFullCard(userId);
  }

  async replacePurposes(userId: string, slugs: string[]) {
    const purposes = await this.prisma.purpose.findMany({ where: { slug: { in: slugs } } });
    if (purposes.length !== new Set(slugs).size) {
      throw new Error("UNKNOWN_PURPOSE_SLUG");
    }
    await this.prisma.userPurpose.deleteMany({ where: { userId } });
    await this.prisma.userPurpose.createMany({
      data: purposes.map((purpose) => ({ userId, purposeId: purpose.id })),
    });
    return this.getFullCard(userId);
  }

  async replacePreferredCountries(userId: string, codes: string[]) {
    const normalized = codes.map((code) => code.toUpperCase());
    if (normalized.length > 0) {
      const known = await this.prisma.country.findMany({ where: { code: { in: normalized } } });
      if (known.length !== new Set(normalized).size) {
        throw new Error("UNKNOWN_COUNTRY_CODE");
      }
    }
    await this.prisma.userPreferredCountry.deleteMany({ where: { userId } });
    if (normalized.length > 0) {
      await this.prisma.userPreferredCountry.createMany({
        data: normalized.map((countryCode) => ({ userId, countryCode })),
      });
    }
    return this.getFullCard(userId);
  }
}
