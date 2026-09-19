import { UsersService } from "./users.service";

type UserRow = {
  id: string;
  email: string;
  status: string;
  nickname: string | null;
  avatarUrl: string | null;
  birthDate: Date | null;
  countryCode: string | null;
  city: string | null;
  region: string | null;
  gender: string;
  bio: string | null;
  languages: Array<{ languageCode: string; type: string; level: string; language: { code: string; name: string; nativeName: string | null } }>;
  interests: Array<{ interest: { slug: string; name: string; nameZh: string | null; category: string } }>;
  purposes: Array<{ purpose: { slug: string; name: string; nameZh: string | null } }>;
  preferredCountries: Array<{ countryCode: string; country: { code: string; name: string; flag: string | null } }>;
  // PC-1.3: the public-profile query also loads the viewer-visible attribute
  // surface and the target's per-field visibility rows.
  attributes: Array<Record<string, unknown>>;
  fieldVisibilities: Array<{ fieldKey: string; visibility: string }>;
};

function makeUser(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: "target-1",
    email: "target@example.com",
    status: "ACTIVE",
    nickname: "Alice",
    avatarUrl: "https://cdn.example.com/a.png",
    birthDate: new Date("1995-01-01"),
    countryCode: "US",
    city: null,
    region: null,
    gender: "FEMALE",
    bio: "hi",
    languages: [{ languageCode: "en", type: "NATIVE", level: "NATIVE", language: { code: "en", name: "English", nativeName: "English" } }],
    interests: [{ interest: { slug: "gaming", name: "Gaming", nameZh: null, category: "Hobby" } }],
    purposes: [{ purpose: { slug: "language-exchange", name: "Language exchange", nameZh: null } }],
    preferredCountries: [{ countryCode: "JP", country: { code: "JP", name: "Japan", flag: "🇯🇵" } }],
    attributes: [],
    fieldVisibilities: [],
    ...overrides,
  };
}

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue(makeUser()),
    },
    block: { findFirst: jest.fn().mockResolvedValue(null) },
    connection: { findFirst: jest.fn().mockResolvedValue({ id: "conn-1" }) },
    country: { findUnique: jest.fn().mockResolvedValue({ code: "US", name: "United States", flag: "🇺🇸" }) },
    ...overrides,
  };
}

describe("UsersService.getPublicProfile", () => {
  it("returns a sanitized profile with no email / admin / status fields", async () => {
    const prisma = makePrisma();
    const service = new UsersService(prisma as never);
    const profile = await service.getPublicProfile("target-1", "viewer-1");

    expect(profile.id).toBe("target-1");
    expect(profile.nickname).toBe("Alice");
    expect(profile.age).toBeGreaterThan(0);
    expect(profile.countryName).toBe("United States");
    expect(profile.relationship.isConnected).toBe(true);
    expect(profile).not.toHaveProperty("email");
    expect(profile).not.toHaveProperty("emailVerified");
    expect(profile).not.toHaveProperty("isAdmin");
    expect(profile).not.toHaveProperty("status");
  });

  it("rejects a blocked target in either direction", async () => {
    const prisma = makePrisma({ block: { findFirst: jest.fn().mockResolvedValue({ id: "b1" }) } });
    const service = new UsersService(prisma as never);
    await expect(service.getPublicProfile("target-1", "viewer-1")).rejects.toMatchObject({
      response: { error: { code: "BLOCKED" } },
    });
  });

  it("treats a non-ACTIVE target as not found", async () => {
    const prisma = makePrisma({
      user: { findUnique: jest.fn().mockResolvedValue(makeUser({ status: "BANNED" })) },
    });
    const service = new UsersService(prisma as never);
    await expect(service.getPublicProfile("target-1", "viewer-1")).rejects.toMatchObject({
      response: { error: { code: "USER_NOT_FOUND" } },
    });
  });

  it("allows self to view their own profile regardless of status", async () => {
    const prisma = makePrisma({
      user: { findUnique: jest.fn().mockResolvedValue(makeUser({ status: "DISABLED" })) },
      block: { findFirst: jest.fn() },
      connection: { findFirst: jest.fn() },
    });
    const service = new UsersService(prisma as never);
    const profile = await service.getPublicProfile("target-1", "target-1");
    expect(profile.relationship.isSelf).toBe(true);
    expect(prisma.block.findFirst).not.toHaveBeenCalled();
  });
});
