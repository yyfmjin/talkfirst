/**
 * FIX (audit P021 / P030) — one keyset cursor implementation for the whole API.
 *
 * ## Why this exists
 *
 * `NotificationsService` already paginated correctly: it ordered by the total
 * order `(createdAt DESC, id DESC)` and resumed with the tuple comparison
 * `(createdAt, id) < cursor`. The moments feed and the chat history did not:
 * both used `createdAt` alone, so two rows written in the *same millisecond*
 * could not be ordered against the cursor and the walk either repeated one of
 * the pair or skipped it. A row's `createdAt` is a millisecond timestamp, and
 * `POST /moments` plus an `await`-driven client can easily produce two rows in
 * the same tick, so this was reachable rather than theoretical.
 *
 * The second half of the same defect: both call sites built the next cursor from
 * an index into a *pre-filter* array (`moments[limit - 1]`) while returning a
 * possibly shorter filtered page, so the cursor could point at a row the caller
 * never saw.
 *
 * ## Why a shared module instead of a third copy
 *
 * The notification cursor is opaque Base64URL of `{createdAt, id}` and has its
 * own decoder plus tests. This module is the *readable* variant used by the two
 * content lists, which keep a plain `"<iso>|<uuid>"` string so existing links
 * and tests stay legible. Both share one invariant: the cursor is a position in
 * a total order, and `take: limit + 1` is the look-ahead that proves more rows
 * exist.
 *
 * A bare ISO timestamp is still accepted (legacy form) and degrades to a
 * `createdAt`-only comparison, so a cursor minted before this change does not
 * 400. A genuinely malformed cursor is a `400 VALIDATION_ERROR` — it used to
 * reach Prisma as `new Date("garbage")`, i.e. an `Invalid Date`, and surfaced as
 * a `500 INTERNAL_ERROR`.
 */

export const INVALID_CURSOR = "INVALID_CURSOR";

/** A decoded keyset position. `id` is null only for a legacy timestamp cursor. */
export type KeysetCursor = { createdAt: Date; id: string | null };

/** Standard error body for a cursor this API did not issue. */
export const INVALID_CURSOR_ERROR = {
  success: false as const,
  error: {
    code: "VALIDATION_ERROR",
    message: "cursor is not a cursor issued by this API",
  },
};

/** The error a service throws; the controller maps it to a 400. */
export function invalidCursorError(): Error & { code: string } {
  const error = new Error(INVALID_CURSOR) as Error & { code: string };
  error.code = INVALID_CURSOR;
  return error;
}

/** `true` when an unknown error is the malformed-cursor signal. */
export function isInvalidCursorError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === INVALID_CURSOR;
}

/** Renders a keyset position. Every caller must pass a row's own id. */
export function encodeKeysetCursor(row: { createdAt: Date; id: string }): string {
  return `${row.createdAt.toISOString()}|${row.id}`;
}

/**
 * Parses `"<iso>|<id>"`, falling back to a legacy bare `"<iso>"`.
 *
 * Throws the `INVALID_CURSOR` error (never returns a partial result) so a
 * caller cannot accidentally treat a malformed cursor as "first page".
 */
export function parseKeysetCursor(raw: string | undefined | null): KeysetCursor | null {
  if (raw === undefined || raw === null) return null;
  const value = raw.trim();
  if (!value) return null;

  const separator = value.lastIndexOf("|");
  if (separator > 0) {
    const createdAt = new Date(value.slice(0, separator));
    const id = value.slice(separator + 1);
    if (!Number.isNaN(createdAt.getTime()) && id) return { createdAt, id };
    throw invalidCursorError();
  }

  // Legacy form: a bare ISO timestamp, accepted only when it round-trips — which
  // is exactly the shape the API used to hand out.
  const createdAt = new Date(value);
  if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== value) {
    throw invalidCursorError();
  }
  return { createdAt, id: null };
}

/**
 * The `where` fragment for a DESCENDING walk (`orderBy: createdAt desc`).
 *
 * `id` must be part of the ordering for a strict keyset comparison to be
 * correct — see `keysetOrderBy`.
 */
export function keysetFilterAfter(cursor: KeysetCursor | null): Record<string, unknown> {
  if (!cursor) return {};
  if (!cursor.id) return { createdAt: { lt: cursor.createdAt } };
  /**
   * Wrapped in `AND` rather than spread straight in, because the tuple form has
   * to emit an `OR` and a caller's own `where` may already use that key — two
   * top-level `OR`s would silently overwrite one another. `AND: [{ OR: [...] }]`
   * composes with anything the caller adds.
   */
  return {
    AND: [
      {
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ],
      },
    ],
  };
}

/**
 * The matching `orderBy`. Pair it with `keysetFilterAfter` — a cursor that
 * compares on `id` against an ordering that does not mention `id` is not a
 * position at all.
 */
export const keysetOrderBy = [{ createdAt: "desc" as const }, { id: "desc" as const }];

/**
 * The cursor for a page, or `null` when the walk is finished.
 *
 * `rows` is the over-fetched result (`take: limit + 1`) and `page` is what is
 * actually being returned, so the cursor is always the last row **the caller
 * received** — never an index into the pre-filter set.
 */
export function keysetNextCursor(
  rowsLength: number,
  limit: number,
  page: ReadonlyArray<{ createdAt: Date; id: string }>,
): string | null {
  if (rowsLength <= limit) return null;
  const last = page[page.length - 1];
  if (!last) return null;
  return encodeKeysetCursor(last);
}
