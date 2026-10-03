import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from "@nestjs/common";

/**
 * Phase C5: the shape a UUID path parameter must have.
 *
 * Shared by the admin and member APIs: the member controllers look their rows up
 * by a `uuid` column with the same Prisma lookups, so a malformed id returned
 * the same `500 INTERNAL_ERROR` there, which is why this moved out of
 * `src/admin` into `src/common` instead of being copied a second time.
 *
 * Kept as a literal here rather than imported from `admin.service.ts`: a pipe
 * that depends on the service would drag Prisma into a transport-layer module
 * for the sake of one regex. `admin-integration.spec.ts` asserts the two copies
 * are character-identical, so they cannot drift apart silently — and since the
 * post-audit move it reads this file (the implementation), not the re-export
 * shim in `src/admin`, so editing this line alone does fail that test.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Rejects a path parameter that is not a UUID, with the project's standard
 * `VALIDATION_ERROR` envelope.
 *
 * ## Why this exists
 *
 * Every admin detail route looks its row up by a `uuid` column. Prisma answers
 * a non-UUID with `PrismaClientKnownRequestError` (P2023, "Inconsistent column
 * data: Error creating UUID"). That is **not** an `HttpException`, so
 * `ApiExceptionFilter` classifies it as an unexpected failure and the caller
 * receives `500 INTERNAL_ERROR` for what is plainly a malformed request.
 *
 * That was observed, not assumed. Against the real API and real PostgreSQL,
 * before this pipe existed:
 *
 *     GET  /admin/users/not-a-uuid            -> 500 INTERNAL_ERROR
 *     GET  /admin/reports/not-a-uuid          -> 500 INTERNAL_ERROR
 *     GET  /admin/connections/not-a-uuid      -> 500 INTERNAL_ERROR
 *     GET  /admin/exchanges/not-a-uuid        -> 500 INTERNAL_ERROR
 *     GET  /admin/blocks/not-a-uuid/not-a-uuid-> 500 INTERNAL_ERROR
 *     POST /admin/users/not-a-uuid/status     -> 500 INTERNAL_ERROR
 *     PATCH/admin/users/not-a-uuid/status     -> 500 INTERNAL_ERROR
 *     POST /admin/users/not-a-uuid/notes      -> 500 INTERNAL_ERROR
 *     POST /admin/reports/not-a-uuid/review   -> 500 INTERNAL_ERROR
 *
 * The per-domain unit specs could not catch it: they drive a mocked Prisma that
 * returns `null` for any key, so a malformed id never reached a real UUID parse.
 * `admin-blocks.spec.ts` even asserts the *intent* — "an id that is not even a
 * UUID is the same 404, not a 500 from Prisma" — but passes a well-formed UUID,
 * so the assertion could never fail. The real-HTTP check lives in
 * `scripts/phaseA-rbac-verify.mjs` (§10h).
 *
 * ## Why it is a pipe, not a check inside the service
 *
 * "The path parameter is not a UUID" is a statement about the wire format, and
 * the controller is where the wire format is known. Putting it in the service
 * would change the *rule ordering* of `setStatus` — a missing reason would start
 * answering `VALIDATION_ERROR` instead of `REASON_REQUIRED`, and every service
 * unit test would have to invent UUID fixtures for ids that in production can
 * only come from a URL. The service's contract is "given these values, apply
 * these rules", and that contract is unchanged.
 *
 * A pipe is also the only spelling that covers all nine entry points with no
 * duplication: the five detail routes plus the two user-status verbs, notes and
 * report review all take their id through `@Param`.
 *
 * ## Why not Nest's `ParseUUIDPipe`
 *
 * It produces `{ statusCode, message, error }`, which carries no `error.code`.
 * `ApiExceptionFilter` forwards a payload verbatim only when it already has a
 * `success` field, so a `ParseUUIDPipe` rejection would reach the client as
 * `400 HTTP_ERROR` — a code the console has no branch for and which no other
 * admin endpoint emits. This pipe reuses the exact envelope `ValidationPipe`
 * and `invalidQuery()` already produce, so a client keeps **one** branch for
 * "your input was wrong". No new error code is introduced.
 *
 * ## What it deliberately does not cover
 *
 * List filters. There a non-UUID is meaningful input — `?user=not-a-uuid` is a
 * nickname search, not an error (see `buildConnectionWhere` / `sideFilter` /
 * `partyFilter`), and rejecting it would break the documented filter contract.
 * The guard is applied to `@Param` only.
 */
@Injectable()
export class UuidParamPipe implements PipeTransform<string, string> {
  transform(value: string, metadata: ArgumentMetadata): string {
    if (typeof value === "string" && UUID_RE.test(value)) return value;

    // `metadata.data` is the parameter name, so the detail key matches the
    // field the client actually sent (`id`, `blockerId`, `blockedId`).
    const field = metadata.data ?? "id";
    throw new BadRequestException({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid path parameter",
        details: { [field]: [`${field} must be a UUID`] },
      },
    });
  }
}
