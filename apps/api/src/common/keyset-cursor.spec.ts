import {
  INVALID_CURSOR,
  encodeKeysetCursor,
  isInvalidCursorError,
  keysetFilterAfter,
  keysetNextCursor,
  keysetOrderBy,
  parseKeysetCursor,
} from "./keyset-cursor";

/**
 * FIX (audit P021 / P030) — the keyset cursor shared by the moments feed, the
 * per-user feed and chat history.
 *
 * The defect this suite pins, stated as the two cases below:
 *
 *   `createdAt` is a millisecond timestamp, so two rows written in the same tick
 *   are indistinguishable to a `createdAt`-only cursor. With `lt`, the walk
 *   SKIPS the other row of the pair; with `lte` it would repeat it. Only a
 *   `(createdAt, id)` tuple is a position in a total order.
 *
 * The second defect is the cursor *source*: it used to be an index into the
 * pre-filter array (`moments[limit - 1]`) rather than the last row actually
 * returned, so a visibility-filtered page could hand back a cursor for a row the
 * caller never saw.
 */

const AT = new Date("2026-09-20T10:00:00.000Z");
const LATER = new Date("2026-09-20T10:00:00.001Z");

function row(id: string, createdAt: Date = AT) {
  return { id, createdAt };
}

describe("encodeKeysetCursor / parseKeysetCursor", () => {
  it("往返不变：encode -> parse 得到同一位置", () => {
    const encoded = encodeKeysetCursor(row("11111111-1111-4111-8111-111111111111"));
    expect(encoded).toBe(`${AT.toISOString()}|11111111-1111-4111-8111-111111111111`);
    expect(parseKeysetCursor(encoded)).toEqual({
      createdAt: AT,
      id: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("无 cursor -> null（第一页，不是错误）", () => {
    expect(parseKeysetCursor(undefined)).toBeNull();
    expect(parseKeysetCursor(null)).toBeNull();
    expect(parseKeysetCursor("")).toBeNull();
    expect(parseKeysetCursor("   ")).toBeNull();
  });

  it("兼容旧的裸 ISO 时间戳 cursor -> id 为 null", () => {
    expect(parseKeysetCursor(AT.toISOString())).toEqual({ createdAt: AT, id: null });
  });

  it("畸形 cursor -> INVALID_CURSOR（不是静默回到第一页）", () => {
    for (const bad of [
      "garbage",
      "2026-09-20|", // 空 id
      "|11111111-1111-4111-8111-111111111111", // 空时间
      "not-a-date|11111111-1111-4111-8111-111111111111",
      "2026-09-20", // 不 round-trip 的日期
      "2026-13-45T99:99:99.000Z",
    ]) {
      expect(() => parseKeysetCursor(bad)).toThrow(INVALID_CURSOR);
    }
  });

  it("isInvalidCursorError 只认自己的 code", () => {
    try {
      parseKeysetCursor("garbage");
      throw new Error("应当抛错");
    } catch (error) {
      expect(isInvalidCursorError(error)).toBe(true);
    }
    expect(isInvalidCursorError(new Error("other"))).toBe(false);
    expect(isInvalidCursorError(null)).toBe(false);
  });
});

describe("keysetFilterAfter — 同一毫秒的行不会被跳过", () => {
  it("无 cursor -> 空条件", () => {
    expect(keysetFilterAfter(null)).toEqual({});
  });

  it("带 id 的 cursor -> 元组比较（严格小于），且包在 AND 里", () => {
    const filter = keysetFilterAfter({ createdAt: AT, id: "row-b" });
    // `AND: [{ OR: [...] }]` rather than a bare `OR`, so a caller's own `OR`
    // cannot be overwritten by spreading the fragment into `where`.
    expect(filter).toEqual({
      AND: [
        {
          OR: [
            { createdAt: { lt: AT } },
            { createdAt: AT, id: { lt: "row-b" } },
          ],
        },
      ],
    });
  });

  it("三行同一 createdAt：cursor 指向第二行时，第三行仍在范围内（不跳过）", () => {
    // rows ordered `(createdAt desc, id desc)`: a, b, c (ids descending).
    const rows = ["c", "b", "a"];
    const filter = keysetFilterAfter({ createdAt: AT, id: "b" }) as {
      AND: Array<{ OR: Array<Record<string, unknown>> }>;
    };
    const matches = (id: string) =>
      filter.AND[0].OR.some((branch) => {
        const idClause = branch.id as { lt?: string } | undefined;
        const dateClause = branch.createdAt as Date | { lt?: Date };
        if (dateClause instanceof Date) {
          return dateClause.getTime() === AT.getTime() && idClause?.lt === "b" && id < "b";
        }
        return (dateClause.lt as Date).getTime() < AT.getTime();
      });

    // Only `a` sorts after `b`; `c` must NOT come back (that would repeat it).
    expect(rows.filter(matches)).toEqual(["a"]);
  });

  it("裸 ISO cursor -> 退化为 createdAt 比较", () => {
    expect(keysetFilterAfter({ createdAt: AT, id: null })).toEqual({
      createdAt: { lt: AT },
    });
  });
});

describe("keysetNextCursor — 游标来自真正返回的页，且需要前瞻", () => {
  it("没有多余行（rows <= limit）-> null，不会多出一个空页", () => {
    const page = [row("a"), row("b")];
    expect(keysetNextCursor(2, 2, page)).toBeNull();
  });

  it("存在前瞻行 -> 游标是返回页的最后一行", () => {
    // limit 2, three rows fetched: page is the first two.
    const page = [row("a", LATER), row("b", AT)];
    expect(keysetNextCursor(3, 2, page)).toBe(encodeKeysetCursor(page[1]));
  });

  it("返回页为空但存在多余行 -> null（不会发出指向未返回行的游标）", () => {
    // This is the visibility-filter case: the over-fetch proved rows exist, but
    // every one was filtered out of the page.
    expect(keysetNextCursor(3, 2, [])).toBeNull();
  });
});

describe("keysetOrderBy", () => {
  it("必须同时按 createdAt 与 id 排序，否则元组比较不是位置", () => {
    expect(keysetOrderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
  });
});
