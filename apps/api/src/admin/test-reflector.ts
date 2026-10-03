import type { Reflector } from "@nestjs/core";
import { PERMISSION_METADATA_KEY } from "./require-permission.decorator";

/**
 * FIX (Phase O0) — a `Reflector` stub that answers the *question actually asked*.
 *
 * ## The defect this replaces
 *
 * Eight admin specs each defined their own copy of:
 *
 *     function reflectorReturning(permission) {
 *       return { getAllAndOverride: jest.fn(() => permission) } as unknown as Reflector;
 *     }
 *
 * That mock returns `permission` for EVERY `getAllAndOverride` call. But
 * `PermissionGuard.canActivate` asks twice, for two different keys:
 *
 *   1. `ADMIN_PUBLIC_METADATA_KEY` — "is this route explicitly public?"
 *   2. `PERMISSION_METADATA_KEY`   — "what permission does it declare?"
 *
 * So the stub answered `"blocks:read"` to question 1 as well, making `isPublic`
 * truthy and hitting `if (isPublic) return true` — the guard returned `true`
 * before it ever evaluated the permission. The assertions that a non-reader is
 * refused therefore failed against a guard that was working perfectly, and the
 * `PERMISSION_UNDECLARED` fail-closed path was never exercised at all: the mock
 * made it unreachable.
 *
 * ## Why this is a test-only fix
 *
 * The guard is fail-closed and correct (`permission.guard.ts:40-78`); the real
 * `Reflector` returns metadata for one specific key, so `isPublic` is genuinely
 * `undefined` on a non-public route. Only the stub conflated the two lookups.
 * No production code changed for this fix.
 *
 * ## The corrected contract
 *
 * The permission is returned for `PERMISSION_METADATA_KEY` and for nothing
 * else, which mirrors the real `@RequirePermission` decorator. A route that is
 * NOT `@AdminPublic()` deliberately resolves to `isPublic === undefined`, so
 * `@AdminPublic()` remains a genuine, explicit opt-in exception — exactly as
 * `admin-integration.spec.ts:370-381` asserts against real controller metadata.
 *
 * `@AdminPublic()` itself needs no stub support: it is verified against the real
 * `Reflect.getMetadata`, not through this mock.
 */
export function reflectorReturning(permission: string | undefined): Reflector {
  return {
    getAllAndOverride: jest.fn((key: unknown) =>
      key === PERMISSION_METADATA_KEY ? permission : undefined,
    ),
  } as unknown as Reflector;
}
