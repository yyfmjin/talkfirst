/**
 * PC-1.3: Profile Attribute API.
 *
 * Owns the user-facing half of the PC-1.2 schema: the SYSTEM catalog selection
 * flow, CUSTOM user-authored tags, `ABOUT_ME` / `LOOKING_FOR` grouping, tag
 * ordering, per-tag visibility, and per-field profile visibility.
 *
 * Invariants enforced here (the schema has no CHECK constraints, so these are
 * application-level — PC-1.2 preflight 2 "APPLICATION_LEVEL_CONSTRAINT"):
 *
 *   SYSTEM  =>  definitionId != null
 *   CUSTOM  =>  definitionId == null && label != null && labelKey != null
 *
 * Block > visibility: callers must run the block check before any read that
 * consults visibility. `SharedSocialAccount` is never involved here.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SafetyService } from "../safety/safety.service";
import {
  CreateUserAttributeDto,
  UpdateUserAttributeDto,
  type AttributeKindValue,
} from "./profile-attributes.dto";
import {
  groupAttributeViews,
  shapeAttribute,
  toAttributeViews,
  type AttributeGroups,
  type AttributeView,
  type UserAttributeRecord,
} from "./profile-attributes.view";
import {
  DEFAULT_FIELD_VISIBILITY,
  PROFILE_VISIBILITY_FIELD_WHITELIST,
  isProfileVisibilityField,
  isVisibilityTier,
  resolveFieldVisibilityMap,
  type ProfileVisibilityField,
  type VisibilityTier,
} from "./profile-visibility.constants";

/** Product decision Q2: at most 10 tags per kind. Enforced in the service
 *  (inside the transaction) rather than by a DB constraint. */
export const ATTRIBUTE_MAX_PER_KIND = 10;
/** Matches `UserAttribute.label` @db.VarChar(32). */
export const ATTRIBUTE_LABEL_MAX_LENGTH = 32;
/** Matches `UserAttribute.value` @db.VarChar(80). */
export const ATTRIBUTE_VALUE_MAX_LENGTH = 80;
/** Q14: bound on client-supplied ordering so a hostile value cannot overflow. */
export const ATTRIBUTE_SORT_ORDER_MAX = 1000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validationError(message: string): BadRequestException {
  return new BadRequestException({
    success: false,
    error: { code: "VALIDATION_ERROR", message },
  });
}

function attributeExistsError(): ConflictException {
  return new ConflictException({
    success: false,
    error: { code: "ATTRIBUTE_EXISTS", message: "This attribute is already on your profile" },
  });
}

function attributeNotFoundError(): NotFoundException {
  return new NotFoundException({
    success: false,
    error: { code: "ATTRIBUTE_NOT_FOUND", message: "Attribute not found" },
  });
}

/** Reuses the existing content-safety code instead of inventing a new one. */
function contentBlockedError(): ForbiddenException {
  return new ForbiddenException({
    success: false,
    error: { code: "MESSAGE_BLOCKED", message: "This attribute cannot be saved" },
  });
}

/** PC-1.3 7 step 1-3: NFKC, trim, collapse internal whitespace. */
export function normalizeAttributeLabel(raw: string): string | null {
  const collapsed = (raw ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!collapsed) return null;
  return collapsed.normalize("NFKC");
}

/**
 * PC-1.3 7 step 4: casefold, then truncate to the column width.
 *
 * `String.prototype.toLowerCase()` is the closest available approximation of
 * Unicode casefolding — JS has no native casefold. Truncation happens on code
 * points (not UTF-16 units) to stay within `VarChar(32)`; a label whose
 * normalized length would exceed the column is rejected before this point, so
 * truncation can only ever cause a duplicate conflict, never silent aliasing.
 */
export function toAttributeLabelKey(normalizedLabel: string): string {
  const folded = normalizedLabel.normalize("NFKC").toLowerCase().normalize("NFKC");
  return Array.from(folded).slice(0, ATTRIBUTE_LABEL_MAX_LENGTH).join("");
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

@Injectable()
export class ProfileAttributesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly safety: SafetyService,
  ) {}

  /** Owner-scoped read: every row, every tier, every review state. */
  async listMine(userId: string): Promise<AttributeGroups> {
    const rows = await this.prisma.userAttribute.findMany({
      where: { userId },
      include: { definition: true },
      orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return groupAttributeViews(toAttributeViews(rows as UserAttributeRecord[]));
  }

  async create(userId: string, dto: CreateUserAttributeDto): Promise<AttributeView> {
    const kind = this.assertKind(dto.kind);

    let definitionId: string | null = null;
    let label: string | null = null;
    let labelKey: string | null = null;

    if (dto.definitionId) {
      // SYSTEM branch. A definition plus a custom label is a contradiction.
      if (dto.label !== undefined && dto.label.trim() !== "") {
        throw validationError("Provide either definitionId or label, not both");
      }
      const definition = await this.prisma.attributeDefinition.findUnique({
        where: { id: dto.definitionId },
      });
      if (!definition) {
        throw validationError("Unknown attribute definition");
      }
      // Q10: a retired tag must not be newly selectable.
      if (!definition.isActive) {
        throw validationError("This attribute is no longer selectable");
      }
      if (definition.kind !== kind) {
        throw validationError("Attribute definition does not match this section");
      }
      definitionId = definition.id;
    } else {
      // CUSTOM branch.
      const normalized = normalizeAttributeLabel(dto.label ?? "");
      if (!normalized) {
        throw validationError("label is required for a custom attribute");
      }
      if (codePointLength(normalized) > ATTRIBUTE_LABEL_MAX_LENGTH) {
        throw validationError(`label must be at most ${ATTRIBUTE_LABEL_MAX_LENGTH} characters`);
      }
      label = normalized;
      labelKey = toAttributeLabelKey(normalized);
      if (!labelKey) {
        throw validationError("label is required for a custom attribute");
      }
    }

    const value = this.normalizeValue(dto.value);
    this.assertSafe([label, value]);

    const created = await this.prisma.$transaction(async (tx) => {
      const count = await tx.userAttribute.count({ where: { userId, kind } });
      if (count >= ATTRIBUTE_MAX_PER_KIND) {
        throw validationError(
          `You can add at most ${ATTRIBUTE_MAX_PER_KIND} items to this section`,
        );
      }

      const duplicate = definitionId
        ? await tx.userAttribute.findFirst({ where: { userId, definitionId } })
        : await tx.userAttribute.findFirst({ where: { userId, kind, labelKey } });
      if (duplicate) throw attributeExistsError();

      // Race: the unique index catches what the pre-check above missed.
      return this.writeOnce(() =>
        tx.userAttribute.create({
          data: {
            userId,
            kind,
            definitionId,
            label,
            labelKey,
            value,
            visibility: DEFAULT_FIELD_VISIBILITY,
            reviewStatus: "APPROVED",
          },
          include: { definition: true },
        }),
      );
    });

    const view = shapeAttribute(created as UserAttributeRecord);
    if (!view) throw validationError("Attribute could not be created");
    return view;
  }

  async update(userId: string, id: string, dto: UpdateUserAttributeDto): Promise<AttributeView> {
    this.assertAttributeId(id);
    const existing = await this.prisma.userAttribute.findFirst({ where: { id, userId } });
    if (!existing) throw attributeNotFoundError();

    const data: {
      label?: string;
      labelKey?: string;
      value?: string | null;
      visibility?: VisibilityTier;
      sortOrder?: number;
    } = {};

    if (dto.label !== undefined) {
      if (existing.definitionId) {
        throw validationError("System tags cannot be renamed");
      }
      const normalized = normalizeAttributeLabel(dto.label);
      if (!normalized) throw validationError("label cannot be empty");
      if (codePointLength(normalized) > ATTRIBUTE_LABEL_MAX_LENGTH) {
        throw validationError(`label must be at most ${ATTRIBUTE_LABEL_MAX_LENGTH} characters`);
      }
      data.label = normalized;
      data.labelKey = toAttributeLabelKey(normalized);
    }

    if (dto.value !== undefined) {
      data.value = this.normalizeValue(dto.value);
    }
    if (dto.visibility !== undefined) {
      if (!isVisibilityTier(dto.visibility)) throw validationError("Unknown visibility");
      data.visibility = dto.visibility;
    }
    if (dto.sortOrder !== undefined) {
      if (
        !Number.isInteger(dto.sortOrder) ||
        dto.sortOrder < 0 ||
        dto.sortOrder > ATTRIBUTE_SORT_ORDER_MAX
      ) {
        throw validationError("sortOrder is out of range");
      }
      data.sortOrder = dto.sortOrder;
    }

    if (Object.keys(data).length === 0) throw validationError("Nothing to update");

    this.assertSafe([data.label ?? null, dto.value !== undefined ? (data.value ?? null) : null]);

    if (data.labelKey) {
      const duplicate = await this.prisma.userAttribute.findFirst({
        where: { userId, kind: existing.kind, labelKey: data.labelKey, NOT: { id } },
      });
      if (duplicate) throw attributeExistsError();
    }

    const updated = await this.writeOnce(() =>
      this.prisma.userAttribute.update({
        where: { id },
        data,
        include: { definition: true },
      }),
    );

    const view = shapeAttribute(updated as UserAttributeRecord);
    if (!view) throw validationError("Attribute could not be updated");
    return view;
  }

  /** Ownership is part of the lookup, so a foreign id is a 404, never a delete. */
  async remove(userId: string, id: string): Promise<{ ok: true }> {
    this.assertAttributeId(id);
    const existing = await this.prisma.userAttribute.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!existing) throw attributeNotFoundError();
    await this.prisma.userAttribute.delete({ where: { id } });
    return { ok: true };
  }

  /** Effective map, materialised for every whitelisted key (absent row = default). */
  async listFieldVisibility(
    userId: string,
  ): Promise<Array<{ fieldKey: ProfileVisibilityField; visibility: VisibilityTier }>> {
    const rows = await this.prisma.profileFieldVisibility.findMany({
      where: { userId },
      select: { fieldKey: true, visibility: true },
    });
    const map = resolveFieldVisibilityMap(rows);
    return PROFILE_VISIBILITY_FIELD_WHITELIST.map((fieldKey) => ({
      fieldKey,
      visibility: map[fieldKey],
    }));
  }

  /**
   * Lazy rows (PC-1.1 Q5 / PC-1.3 17): setting a field back to the default
   * deletes the row instead of storing a redundant PUBLIC, and no existing
   * account is ever backfilled.
   */
  async setFieldVisibility(
    userId: string,
    fieldKey: string,
    visibility: VisibilityTier,
  ): Promise<Array<{ fieldKey: ProfileVisibilityField; visibility: VisibilityTier }>> {
    if (!isProfileVisibilityField(fieldKey)) {
      throw validationError("Unknown profile field");
    }
    if (!isVisibilityTier(visibility)) {
      throw validationError("Unknown visibility");
    }

    if (visibility === DEFAULT_FIELD_VISIBILITY) {
      await this.prisma.profileFieldVisibility.deleteMany({ where: { userId, fieldKey } });
    } else {
      await this.prisma.profileFieldVisibility.upsert({
        where: { userId_fieldKey: { userId, fieldKey } },
        create: { userId, fieldKey, visibility },
        update: { visibility },
      });
    }

    return this.listFieldVisibility(userId);
  }

  /**
   * Turns a Prisma unique-constraint violation into the stable API error.
   * `P2002` must never reach the client: it leaks index names and is not part of
   * the error contract.
   */
  private async writeOnce<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") throw attributeExistsError();
      throw error;
    }
  }

  private assertKind(kind: string | undefined): AttributeKindValue {
    if (kind === "ABOUT_ME" || kind === "LOOKING_FOR") return kind;
    throw validationError("kind must be ABOUT_ME or LOOKING_FOR");
  }

  /** A malformed id is reported as not-found rather than reaching Prisma. */
  private assertAttributeId(id: string): void {
    if (!UUID_PATTERN.test(id)) throw attributeNotFoundError();
  }

  /** NFKC + trim; an empty result means "no value". Internal whitespace is kept
   *  because free-text values may legitimately contain it. */
  private normalizeValue(raw?: string): string | null {
    if (raw === undefined) return null;
    const trimmed = raw.normalize("NFKC").trim();
    if (!trimmed) return null;
    if (codePointLength(trimmed) > ATTRIBUTE_VALUE_MAX_LENGTH) {
      throw validationError(`value must be at most ${ATTRIBUTE_VALUE_MAX_LENGTH} characters`);
    }
    return trimmed;
  }

  /**
   * Q1: user-authored text is scanned before it is written. Both signals matter:
   * the existing chat callers only check `blocked`, but `recordAutoFlag` returns
   * early on HIGH, so a HIGH scan would otherwise be written and never flagged.
   * `SafetyService` itself is untouched.
   */
  private assertSafe(texts: Array<string | null>): void {
    for (const text of texts) {
      if (!text) continue;
      const scan = this.safety.scanText(text);
      if (scan.blocked || scan.level === "HIGH") throw contentBlockedError();
    }
  }
}
