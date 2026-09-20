import { isUUID } from "class-validator";

/**
 * PC-3.1d — the opaque cursor for `GET /notifications`.
 *
 * ## Why it carries two fields
 *
 * The list is ordered `createdAt DESC, id DESC`. A cursor built from
 * `createdAt` alone would not be a position: two notifications written in the
 * same millisecond share it, so "everything strictly older than this" would
 * either repeat the *other* row of the pair (if the boundary is `<=`) or skip it
 * (if the boundary is `<`). Carrying `id` as well turns the sort key into a
 * total order, and the query becomes the standard tuple comparison
 * `(createdAt, id) < (cursor.createdAt, cursor.id)`.
 *
 * ## Why it is opaque
 *
 * It is Base64URL of a JSON object rather than a readable `createdAt|id` pair so
 * that a client cannot construct one by hand and come to depend on the field
 * names. The pair is an implementation detail of this endpoint; the string is
 * the contract. Base64URL specifically, not Base64, because the value travels in
 * a query string and `+` / `/` / `=` would need escaping.
 *
 * ## Why decoding is strict
 *
 * A cursor only ever comes from this service, so anything that does not decode
 * back into exactly one is a malformed request, and the caller says so with a
 * `400` rather than quietly starting from the top — a silent fallback to page 1
 * would make a client loop over the first page forever without ever seeing an
 * error. `null` is the single "this is not a cursor" answer; the pipe turns it
 * into the project's `VALIDATION_ERROR` envelope.
 */

export type NotificationCursor = {
  /** Primary half of the sort key. */
  createdAt: Date;
  /** Tie-break, so a same-millisecond pair still has one order. */
  id: string;
};

export function encodeNotificationCursor(cursor: NotificationCursor): string {
  return Buffer.from(
    JSON.stringify({ createdAt: cursor.createdAt.toISOString(), id: cursor.id }),
    "utf8",
  ).toString("base64url");
}

export function decodeNotificationCursor(raw: string): NotificationCursor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    // Not Base64URL at all, or not JSON once decoded. `Buffer.from` is lenient
    // about invalid characters, which is why the JSON parse is the real gate.
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const { createdAt, id } = parsed as { createdAt?: unknown; id?: unknown };
  if (typeof createdAt !== "string" || typeof id !== "string") return null;

  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  // Canonical round-trip: `toISOString()` is the only spelling this encoder ever
  // writes, so accepting a looser form (a bare `2026-09-20`, or an offset the
  // platform parser happens to guess at) would widen the surface without ever
  // serving a real cursor.
  if (date.toISOString() !== createdAt) return null;

  // Shape only, exactly like `UuidParamPipe`: it decides whether the value can
  // reach a `uuid` column, not whether such a row exists.
  if (!isUUID(id)) return null;

  return { createdAt: date, id };
}
