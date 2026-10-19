/**
 * P0-03 — the four sections a member actually thinks in.
 *
 * The database models this as two `AttributeKind`s (`ABOUT_ME` / `LOOKING_FOR`) plus a
 * free-text `category` on each `AttributeDefinition`. The product brief describes four
 * sections — 我的性格 / 我的兴趣 / 交流方式 / 我想认识.
 *
 * ## The decision (2026-10-04): `category` carries the section
 *
 * Adding `PERSONALITY` / `COMMUNICATION` enum values was the alternative. It was rejected:
 * it needs a migration, a change to the profile-visibility surface, and edits to a pile of
 * existing assertions — for no capability the current model cannot already express. The
 * category column is already `VarChar(32)` and already ships to the client
 * (`profile-attributes.view.ts` exposes `category` on every view).
 *
 * ## Why several categories fold into one title
 *
 * The brief treats music, travel, food and photography as *interests*, while the shipped
 * catalogue happens to file them under `Music` / `Travel` / `Lifestyle` / `Hobby`. Folding
 * them here means the database's internal filing does not leak into the interface.
 *
 * ## An unknown category is never dropped
 *
 * It keeps its own raw name as a heading. A category added in the database shows up under
 * its own name instead of silently disappearing, which is the failure mode worth avoiding.
 */
import type { MsgKey } from "@/lib/i18n";

/**
 * 分区 id（不是文案）。文案在词典里，由消费方 `t()` 渲染 ——
 * 模块级常量表拿不到当前语言，存中文句子会让英文界面直接显示出中文。
 */
export type AttributeSectionId = "personality" | "interests" | "communication";

export const ATTRIBUTE_SECTION_KEYS: Record<AttributeSectionId, MsgKey> = {
  personality: "as.personality",
  interests: "as.interests",
  communication: "as.communication",
};

const SECTION_BY_CATEGORY: Record<string, AttributeSectionId> = {
  Personality: "personality",
  Hobby: "interests",
  Music: "interests",
  Lifestyle: "interests",
  Culture: "interests",
  Gaming: "interests",
  Travel: "interests",
  Communication: "communication",
};

/** The brief's order. Anything unrecognised sorts after these, by name. */
const SECTION_ORDER = ["personality", "interests", "communication"];

/**
 * `category` → 分区 id。
 *
 * 沜不认识的 category **不被丢掉**：它自己当作 id 返回（消费方原样展示 category 名），
 * 这样数据库里新加的分类会以自己的名字出现，而不是默默消失。
 */
export function attributeSectionId(category: string): string {
  return SECTION_BY_CATEGORY[category] ?? category;
}

/** 分区的词条键；不认识的 category 返回 `null`，由调用方决定怎么展示。 */
export function attributeSectionTitleKey(id: string): MsgKey | null {
  return id in ATTRIBUTE_SECTION_KEYS ? ATTRIBUTE_SECTION_KEYS[id as AttributeSectionId] : null;
}

/**
 * Groups items by section id, in the brief's order.
 *
 * `items` must each carry a `category`; the return value keeps the input order within a
 * section, so a caller that already sorted by `sortOrder` does not lose that.
 */
export function groupByAttributeSection<T extends { category: string }>(
  items: T[],
): Array<{ id: string; entries: T[] }> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const id = attributeSectionId(item.category);
    const bucket = groups.get(id);
    if (bucket) bucket.push(item);
    else groups.set(id, [item]);
  }
  return [...groups.entries()]
    .map(([id, entries]) => ({ id, entries }))
    .sort((a, b) => {
      const rank = (id: string) => {
        const index = SECTION_ORDER.indexOf(id);
        return index === -1 ? SECTION_ORDER.length : index;
      };
      return rank(a.id) - rank(b.id) || a.id.localeCompare(b.id, "zh");
    });
}
