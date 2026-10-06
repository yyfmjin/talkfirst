/**
 * PC-1.4: the front-end contract for the profile API.
 *
 * These types mirror `apps/api/src/users/users.service.ts` (`PublicProfile` /
 * `PublicCard`) and `apps/api/src/users/profile-attributes.view.ts`
 * (`AttributeView`) exactly. This module is the single place the web app
 * describes what the API returns — a page-local duplicate is how the previous
 * `PublicProfile` drifted (missing `region`/`attributes`, non-nullable
 * `gender`).
 */

/** `Visibility` enum: per-attribute tier and per-field profile tier share it. */
export type VisibilityTier = "PUBLIC" | "CONNECTIONS" | "PRIVATE";

export type AttributeKind = "ABOUT_ME" | "LOOKING_FOR";

/** Derived by the API from `definitionId`; never sent by the client. */
export type AttributeSource = "SYSTEM" | "CUSTOM";

export type AttributeView = {
  id: string;
  kind: AttributeKind;
  source: AttributeSource;
  definitionId: string | null;
  /** Catalog key — SYSTEM rows only. */
  key: string | null;
  category: string | null;
  label: string;
  labelZh: string | null;
  value: string | null;
  visibility: VisibilityTier;
  sortOrder: number;
  /** `PENDING` / `REJECTED` rows are only visible to their owner. */
  reviewStatus: string;
  /**
   * `null` for CUSTOM rows; `false` for a SYSTEM row whose tag was retired.
   * A retired tag must stay rendered — the selection is kept, it just cannot be
   * re-chosen (PC-1.2 Q10).
   */
  definitionActive: boolean | null;
  createdAt: string;
  updatedAt: string;
};

export type AttributeGroups = {
  aboutMe: AttributeView[];
  lookingFor: AttributeView[];
};

/** One row of `GET /meta/attributes` (the raw `AttributeDefinition` model). */
export type AttributeDefinition = {
  id: string;
  key: string;
  scope: AttributeSource;
  kind: AttributeKind;
  category: string;
  label: string;
  labelZh: string | null;
  valueType: string;
  sort: number;
  isActive: boolean;
  isSearchable: boolean;
};

/**
 * `GET /users/:id`. Scalar fields the viewer may not see arrive as `null`, and
 * aggregate fields as `[]`, so a hidden field is indistinguishable from an
 * unset one.
 */
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
  /** Governed by `ProfileFieldVisibility`, hence nullable. */
  gender: string | null;
  bio: string | null;
  languages: Array<{ code: string; name: string; nativeName: string | null; type: string; level: string }>;
  interests: Array<{ slug: string; name: string; nameZh: string | null; category: string }>;
  purposes: Array<{ slug: string; name: string; nameZh: string | null }>;
  preferredCountries: Array<{ code: string; name: string; flag: string | null }>;
  attributes: AttributeGroups;
  relationship: { isSelf: boolean; isConnected: boolean };
  /**
   * 送花（虚拟礼物，2026-10-06）：收到花的朵数，以及查看者自己送过没有。
   * 镜像 `apps/api/src/users/users.service.ts` 的 `PublicProfile`。
   */
  flowerCount: number;
  flowerFromViewer: boolean;
};

/**
 * The closed whitelist of governed profile fields.
 *
 * Must stay identical to `PROFILE_VISIBILITY_FIELD_WHITELIST` in
 * `apps/api/src/users/profile-visibility.constants.ts`: the API answers 400 for
 * anything else, and nothing outside this list (`email`, `passwordHash`,
 * `isAdmin`, social handles…) is ever toggleable.
 */
export const PROFILE_VISIBILITY_FIELDS = [
  "nickname",
  "avatarUrl",
  "birthDate",
  "countryCode",
  "city",
  "region",
  "gender",
  "bio",
  "languages",
  "interests",
  "purposes",
  "preferredCountries",
  "attributes",
] as const;

export type ProfileVisibilityField = (typeof PROFILE_VISIBILITY_FIELDS)[number];

export type FieldVisibilityRow = {
  fieldKey: ProfileVisibilityField;
  visibility: VisibilityTier;
};

export const VISIBILITY_TIERS: readonly VisibilityTier[] = ["PUBLIC", "CONNECTIONS", "PRIVATE"];

/** User-facing wording — the raw enum names are never shown to members. */
export const VISIBILITY_LABELS: Record<VisibilityTier, string> = {
  PUBLIC: "公开",
  CONNECTIONS: "仅好友/连接可见",
  PRIVATE: "仅自己可见",
};

export const VISIBILITY_HINTS: Record<VisibilityTier, string> = {
  PUBLIC: "任何登录用户都能看到",
  CONNECTIONS: "只有已建立连接的对方能看到",
  PRIVATE: "只有你自己能看到",
};

/** Compact wording for the 3-way segmented control, where space is tight. */
export const VISIBILITY_SHORT_LABELS: Record<VisibilityTier, string> = {
  PUBLIC: "公开",
  CONNECTIONS: "仅连接",
  PRIVATE: "仅自己",
};

export const FIELD_VISIBILITY_LABELS: Record<ProfileVisibilityField, string> = {
  nickname: "昵称",
  avatarUrl: "头像",
  birthDate: "年龄",
  countryCode: "国家/地区",
  city: "城市",
  region: "地区",
  gender: "性别",
  bio: "个人简介",
  languages: "语言",
  interests: "兴趣",
  purposes: "交友目的",
  preferredCountries: "想认识的国家",
  attributes: "交友属性（我的介绍 / 交友需求）",
};

/** The tier assumed when the API reports no stored row for a field. */
export const DEFAULT_FIELD_VISIBILITY: VisibilityTier = "PUBLIC";

/** `labelZh` is only meaningful for system tags, where it may be absent. */
export function attributeLabel(attribute: Pick<AttributeView, "label" | "labelZh" | "source">): string {
  return attribute.source === "SYSTEM" ? attribute.labelZh ?? attribute.label : attribute.label;
}

export function avatarInitial(nickname: string | null | undefined): string {
  return (nickname ?? "?").slice(0, 1).toUpperCase();
}
