import type { User } from "@prisma/client";
import { isProfileComplete } from "../users/profile-completion";

/**
 * The public projection of a `User` — the shape every client receives.
 *
 * Extracted from `AuthService` into a plain function because two services now
 * need it (`AuthService` and `SessionService`) and having `SessionService` call a
 * static on `AuthService` would make the two classes depend on each other.
 *
 * ## This is an ALLOW-LIST, and that is the point
 *
 * It enumerates what may leave, rather than deleting what must not. A new column
 * on `User` is therefore invisible to clients until somebody deliberately adds it
 * here — the reverse arrangement (spread the row, delete the secrets) leaks by
 * default, and the repo has a long list of tests that scan responses for
 * `passwordHash` / `token` / `oauth` precisely because that failure mode is real.
 *
 * `passwordHash` is now nullable, and `hasPassword` is deliberately NOT part of
 * this shape: whether an account has a password is account-management state, not
 * public profile data. The OAuth flow reports it separately and only to the
 * client that just proved control of the address.
 */
export function toPublicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    status: user.status,
    isAdmin: user.isAdmin,
    nickname: user.nickname,
    avatarUrl: user.avatarUrl,
    birthDate: user.birthDate,
    countryCode: user.countryCode,
    city: user.city,
    gender: user.gender,
    bio: user.bio,
    profileCompleted: isProfileComplete(user),
    createdAt: user.createdAt,
    lastActiveAt: user.lastActiveAt,
  };
}
