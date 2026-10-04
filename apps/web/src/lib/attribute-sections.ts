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
export const ATTRIBUTE_SECTION_TITLES: Record<string, string> = {
  Personality: "我的性格",
  Hobby: "我的兴趣",
  Music: "我的兴趣",
  Lifestyle: "我的兴趣",
  Culture: "我的兴趣",
  Gaming: "我的兴趣",
  Travel: "我的兴趣",
  Communication: "交流方式",
};

/** The brief's order. Anything unrecognised sorts after these, by name. */
const SECTION_ORDER = ["我的性格", "我的兴趣", "交流方式"];

export function attributeSectionTitle(category: string): string {
  return ATTRIBUTE_SECTION_TITLES[category] ?? category;
}

/**
 * Groups items by section title, in the brief's order.
 *
 * `items` must each carry a `category`; the return value keeps the input order within a
 * section, so a caller that already sorted by `sortOrder` does not lose that.
 */
export function groupByAttributeSection<T extends { category: string }>(
  items: T[],
): Array<{ title: string; entries: T[] }> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const title = attributeSectionTitle(item.category);
    const bucket = groups.get(title);
    if (bucket) bucket.push(item);
    else groups.set(title, [item]);
  }
  return [...groups.entries()]
    .map(([title, entries]) => ({ title, entries }))
    .sort((a, b) => {
      const rank = (title: string) => {
        const index = SECTION_ORDER.indexOf(title);
        return index === -1 ? SECTION_ORDER.length : index;
      };
      return rank(a.title) - rank(b.title) || a.title.localeCompare(b.title, "zh");
    });
}
