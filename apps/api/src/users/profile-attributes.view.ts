/**
 * PC-1.3: shaping + filtering of `UserAttribute` rows.
 *
 * Kept separate from `ProfileAttributesService` because both the mutation
 * service and the read-only profile paths (`UsersService.getPublicProfile` /
 * `getFullCard`) need identical output, and neither should depend on the other.
 * Everything here is pure so it is trivially unit-testable.
 */
import {
  canViewField,
  isVisibilityTier,
  type ViewerContext,
  type VisibilityTier,
} from "./profile-visibility.constants";

export type AttributeKindName = "ABOUT_ME" | "LOOKING_FOR";
export type AttributeSourceName = "SYSTEM" | "CUSTOM";

/** Shape of the `definition` include. */
export type AttributeDefinitionRecord = {
  id: string;
  key: string;
  kind: string;
  category: string;
  label: string;
  labelZh: string | null;
  valueType: string;
  isActive: boolean;
};

/** Shape of a `UserAttribute` row (with or without its definition include). */
export type UserAttributeRecord = {
  id: string;
  kind: string;
  definitionId: string | null;
  definition?: AttributeDefinitionRecord | null;
  label: string | null;
  value: string | null;
  visibility: string;
  sortOrder: number;
  reviewStatus: string;
  createdAt: Date;
  updatedAt: Date;
};

export type AttributeView = {
  id: string;
  kind: AttributeKindName;
  /** Derived from `definitionId`, never stored: a row whose definition was
   *  deleted (SetNull) degrades to CUSTOM, matching the schema's Q10 comment. */
  source: AttributeSourceName;
  definitionId: string | null;
  /** Catalog key, SYSTEM rows only. */
  key: string | null;
  category: string | null;
  /** Display label: the definition's label for SYSTEM rows, otherwise `row.label`. */
  label: string;
  labelZh: string | null;
  value: string | null;
  visibility: VisibilityTier;
  sortOrder: number;
  reviewStatus: string;
  /** `null` for CUSTOM rows; `false` for a SYSTEM row whose tag was retired. */
  definitionActive: boolean | null;
  createdAt: string;
  updatedAt: string;
};

export type AttributeGroups = {
  aboutMe: AttributeView[];
  lookingFor: AttributeView[];
};

/**
 * Returns `null` for a row that cannot be rendered (no definition and no custom
 * label — only reachable if a definition was deleted before the SetNull
 * degradation was in place). Callers drop those instead of emitting a blank tag.
 */
export function shapeAttribute(record: UserAttributeRecord): AttributeView | null {
  const definition = record.definition ?? null;
  const label = definition?.label ?? record.label;
  if (!label) return null;

  return {
    id: record.id,
    kind: record.kind === "LOOKING_FOR" ? "LOOKING_FOR" : "ABOUT_ME",
    source: record.definitionId ? "SYSTEM" : "CUSTOM",
    definitionId: record.definitionId ?? null,
    key: definition?.key ?? null,
    category: definition?.category ?? null,
    label,
    labelZh: definition?.labelZh ?? null,
    value: record.value ?? null,
    visibility: isVisibilityTier(record.visibility) ? record.visibility : "PUBLIC",
    sortOrder: record.sortOrder,
    reviewStatus: record.reviewStatus,
    definitionActive: definition ? definition.isActive : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toAttributeViews(records: UserAttributeRecord[]): AttributeView[] {
  const views: AttributeView[] = [];
  for (const record of records) {
    const view = shapeAttribute(record);
    if (view) views.push(view);
  }
  return views;
}

export function groupAttributeViews(views: AttributeView[]): AttributeGroups {
  return {
    aboutMe: views.filter((view) => view.kind === "ABOUT_ME"),
    lookingFor: views.filter((view) => view.kind === "LOOKING_FOR"),
  };
}

/**
 * Viewer-aware projection used by `GET /users/:id`.
 *
 * Two independent gates:
 *  1. `reviewStatus` — only `APPROVED` rows are shown to anyone but the owner
 *     (the owner must still see their own PENDING/REJECTED rows).
 *  2. per-attribute `visibility` — PUBLIC / CONNECTIONS / PRIVATE.
 *
 * Retired system tags (`definitionActive === false`) are deliberately NOT
 * filtered out: Q10 requires existing selections to keep resolving after an
 * admin stops offering a tag.
 *
 * Callers must have run the block check first: a block overrides everything.
 */
export function filterAttributesForViewer(
  records: UserAttributeRecord[],
  viewer: ViewerContext,
): AttributeGroups {
  const visible = toAttributeViews(records).filter((view) => {
    if (!viewer.isSelf && view.reviewStatus !== "APPROVED") return false;
    return canViewField(view.visibility, viewer);
  });
  return groupAttributeViews(visible);
}
