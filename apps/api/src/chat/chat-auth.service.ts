import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { JWT_ACCESS_SECRET } from "../auth/auth.constants";
import { emailVerificationEnforced } from "../auth/email-verification.policy";
import { jwtSecretOrDevFallback } from "../common/security-config";

export type SocketAuthUser = { id: string; email: string };
export type SocketAuthFailure =
  | "MISSING"
  | "INVALID"
  | "BANNED"
  | "DISABLED"
  | "EMAIL_VERIFIED_REQUIRED";

@Injectable()
export class ChatAuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async verifyAccessToken(raw: string | undefined): Promise<{ user: SocketAuthUser | null; failure: SocketAuthFailure | null }> {
    if (!raw) return { user: null, failure: "MISSING" };
    try {
      const payload = await this.jwtService.verifyAsync<{
        sub: string;
        email: string;
        type: string;
      }>(raw, { secret: jwtSecretOrDevFallback(JWT_ACCESS_SECRET) });
      if (payload.type !== "access") return { user: null, failure: "INVALID" };
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, status: true, emailVerified: true },
      });
      if (!user) return { user: null, failure: "INVALID" };
      if (user.status === "BANNED") return { user: null, failure: "BANNED" };
      if (user.status !== "ACTIVE") return { user: null, failure: "DISABLED" };
      // SEC-005 — the Socket.IO handshake must agree with `JwtStrategy`, or an
      // unverified account locked out of the HTTP business API could still open a
      // chat socket. The flag is read from the database on every handshake, so a
      // token minted before verification cannot bypass the gate, and verifying
      // later makes the same unexpired token work without a re-login. A socket has
      // no request path, so there is no allow-list here: every unverified account
      // is refused while enforcement is on. The check runs *after* the status
      // checks so SEC-002's verdicts are unchanged.
      if (emailVerificationEnforced() && !user.emailVerified) {
        return { user: null, failure: "EMAIL_VERIFIED_REQUIRED" };
      }
      return { user: { id: user.id, email: user.email }, failure: null };
    } catch {
      return { user: null, failure: "INVALID" };
    }
  }

  extractToken(headers: Record<string, string | string[] | undefined>, auth: unknown): string | undefined {
    const fromAuth =
      typeof auth === "object" && auth !== null
        ? (auth as { token?: unknown }).token
        : undefined;
    if (typeof fromAuth === "string" && fromAuth.length > 0) return fromAuth;

    const authorization = headers.authorization ?? headers.Authorization;
    const header = Array.isArray(authorization) ? authorization[0] : authorization;
    if (typeof header === "string" && header.startsWith("Bearer ")) {
      return header.slice("Bearer ".length);
    }

    const cookieHeader = headers.cookie;
    const cookies = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
    if (typeof cookies === "string") {
      const match = cookies
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith("tf_access="));
      if (match) return decodeURIComponent(match.slice("tf_access=".length));
    }
    return undefined;
  }
}
