// Aliased: this file already has a local `makeAuthService` of its own.
import { makeAuthService as buildAuthService } from "./auth-service.fixture";
import * as bcrypt from "bcryptjs";

jest.mock("bcryptjs", () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

const user = {
  id: "user-1",
  email: "alice@example.com",
  passwordHash: "old-hash",
  emailVerified: true,
  status: "ACTIVE",
  isAdmin: false,
  nickname: "Alice",
  avatarUrl: null,
  birthDate: null,
  countryCode: null,
  city: null,
  gender: "UNKNOWN",
  bio: null,
  createdAt: new Date(),
  lastActiveAt: new Date(),
};

function makeAuthService(overrides: Record<string, unknown> = {}) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(user),
      update: jest.fn().mockResolvedValue(user),
    },
    refreshToken: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({ id: "rt-1" }),
    },
    $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
    ...overrides,
  };
  const jwtService = { signAsync: jest.fn().mockResolvedValue("access-token") };
  const service = buildAuthService(prisma as never, jwtService as never);
  return { service, prisma };
}

describe("AuthService.changePassword", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects a wrong current password", async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    const { service } = makeAuthService();
    await expect(
      service.changePassword("user-1", {
        currentPassword: "wrong",
        newPassword: "newpassword1",
        confirmPassword: "newpassword1",
      }),
    ).rejects.toMatchObject({ response: { error: { code: "INVALID_CREDENTIALS" } } });
  });

  it("rejects mismatched confirmation", async () => {
    const { service } = makeAuthService();
    await expect(
      service.changePassword("user-1", {
        currentPassword: "oldpassword",
        newPassword: "newpassword1",
        confirmPassword: "different",
      }),
    ).rejects.toMatchObject({ response: { error: { code: "PASSWORD_MISMATCH" } } });
  });

  it("rejects reusing the current password", async () => {
    const { service } = makeAuthService();
    await expect(
      service.changePassword("user-1", {
        currentPassword: "samepass1",
        newPassword: "samepass1",
        confirmPassword: "samepass1",
      }),
    ).rejects.toMatchObject({ response: { error: { code: "PASSWORD_UNCHANGED" } } });
  });

  it("rotates the hash, revokes refresh tokens and issues a new session", async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (bcrypt.hash as jest.Mock).mockResolvedValue("new-hash");
    const { service, prisma } = makeAuthService();
    const session = await service.changePassword("user-1", {
      currentPassword: "oldpassword",
      newPassword: "newpassword1",
      confirmPassword: "newpassword1",
    });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { passwordHash: "new-hash" },
    });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(session.accessToken).toBe("access-token");
    expect(session.refreshToken).toEqual(expect.any(String));
  });
});
