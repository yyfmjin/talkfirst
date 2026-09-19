import {
  ProfileAttributesService,
  normalizeAttributeLabel,
  toAttributeLabelKey,
} from "./profile-attributes.service";
import { PROFILE_VISIBILITY_FIELD_WHITELIST } from "./profile-visibility.constants";

const LOW_SCAN = {
  level: "LOW",
  // Annotated explicitly: a bare [] infers never[], which makes
  // Partial<typeof LOW_SCAN>.reasons reject any real reason string.
  reasons: [] as string[],
  hasExternalLink: false,
  hasContactLeak: false,
  blocked: false,
};

function makeSafety(scan: Partial<typeof LOW_SCAN> = {}) {
  return { scanText: jest.fn().mockReturnValue({ ...LOW_SCAN, ...scan }) };
}

function makePrisma() {
  const prisma = {
    attributeDefinition: { findUnique: jest.fn() },
    userAttribute: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn().mockResolvedValue({ id: "attr-1" }),
    },
    profileFieldVisibility: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn(),
  };
  // Interactive-transaction stub: run the callback against the same stub, which
  // is exactly how the service uses it (count + dedupe + create atomically).
  prisma.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? await (arg as (tx: typeof prisma) => Promise<unknown>)(prisma) : arg,
  );
  prisma.userAttribute.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "attr-new",
    definition: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...data,
  }));
  prisma.userAttribute.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "attr-1",
    kind: "ABOUT_ME",
    definitionId: null,
    definition: null,
    label: "City Pop",
    value: null,
    visibility: "PUBLIC",
    sortOrder: 0,
    reviewStatus: "APPROVED",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...data,
  }));
  return prisma;
}

function makeService(prisma = makePrisma(), safety = makeSafety()) {
  return {
    prisma,
    safety,
    service: new ProfileAttributesService(prisma as never, safety as never),
  };
}

function definition(overrides: Record<string, unknown> = {}) {
  return {
    id: "def-1",
    key: "looking-gaming-buddy",
    kind: "LOOKING_FOR",
    category: "Gaming",
    label: "Gaming Buddy",
    labelZh: "游戏好友",
    valueType: "BOOLEAN",
    sort: 2,
    isActive: true,
    isSearchable: true,
    ...overrides,
  };
}

const ERROR_CODES = (code: string) => ({ response: { error: { code } } });
const ATTRIBUTE_ID = "11111111-1111-4111-8111-111111111111";

describe("attribute label normalization", () => {
  it("collapses whitespace, trims, and NFKC-normalizes", () => {
    expect(normalizeAttributeLabel("  City   Pop ")).toBe("City Pop");
    expect(normalizeAttributeLabel("Ｃｉｔｙ　Ｐｏｐ")).toBe("City Pop");
  });

  it("treats blank input as no label", () => {
    expect(normalizeAttributeLabel("")).toBeNull();
    expect(normalizeAttributeLabel("   ")).toBeNull();
    expect(normalizeAttributeLabel("\u3000")).toBeNull();
  });

  it("casefolds the uniqueness key and stays inside the column width", () => {
    expect(toAttributeLabelKey("City Pop")).toBe("city pop");
    expect(toAttributeLabelKey("ＣＩＴＹ")).toBe("city");
    expect(Array.from(toAttributeLabelKey("Ｗ".repeat(40))).length).toBe(32);
    expect(Array.from(toAttributeLabelKey("İstanbul")).length).toBeLessThanOrEqual(32);
  });
});

describe("ProfileAttributesService.create", () => {
  it("creates an ABOUT_ME custom attribute owned by the JWT subject", async () => {
    const { prisma, service } = makeService();
    const view = await service.create("user-1", { kind: "ABOUT_ME", label: "City Pop" });

    expect(view.kind).toBe("ABOUT_ME");
    expect(view.source).toBe("CUSTOM");
    expect(view.definitionId).toBeNull();
    expect(view.visibility).toBe("PUBLIC");
    expect(view.reviewStatus).toBe("APPROVED");
    expect(prisma.userAttribute.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          kind: "ABOUT_ME",
          definitionId: null,
          label: "City Pop",
          labelKey: "city pop",
        }),
      }),
    );
  });

  it("creates a LOOKING_FOR custom attribute", async () => {
    const { prisma, service } = makeService();
    const view = await service.create("user-1", { kind: "LOOKING_FOR", label: "  夜猫子  " });

    expect(view.kind).toBe("LOOKING_FOR");
    expect(prisma.userAttribute.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ label: "夜猫子", labelKey: "夜猫子" }),
      }),
    );
  });

  it("rejects more than 10 attributes per kind", async () => {
    const { prisma, service } = makeService();
    prisma.userAttribute.count.mockResolvedValue(10);

    await expect(service.create("user-1", { kind: "ABOUT_ME", label: "Extra" })).rejects.toMatchObject(
      ERROR_CODES("VALIDATION_ERROR"),
    );
    expect(prisma.userAttribute.create).not.toHaveBeenCalled();
  });

  it("counts only the target kind", async () => {
    const { prisma, service } = makeService();
    await service.create("user-1", { kind: "LOOKING_FOR", label: "Same Tag" });
    expect(prisma.userAttribute.count).toHaveBeenCalledWith({
      where: { userId: "user-1", kind: "LOOKING_FOR" },
    });
  });

  it("reports a duplicate custom label as a stable conflict, scoped to the kind", async () => {
    const { prisma, service } = makeService();
    prisma.userAttribute.findFirst.mockResolvedValue({ id: "existing" });

    await expect(service.create("user-1", { kind: "ABOUT_ME", label: "City Pop" })).rejects.toMatchObject(
      ERROR_CODES("ATTRIBUTE_EXISTS"),
    );
    expect(prisma.userAttribute.findFirst).toHaveBeenCalledWith({
      where: { userId: "user-1", kind: "ABOUT_ME", labelKey: "city pop" },
    });
    expect(prisma.userAttribute.create).not.toHaveBeenCalled();
  });

  it("deduplicates a normalized duplicate (case + spacing variants)", async () => {
    const { prisma, service } = makeService();
    prisma.userAttribute.findFirst.mockImplementation(
      async ({ where }: { where: Record<string, unknown> }) =>
        (where as { labelKey?: string }).labelKey === "city pop" ? { id: "existing" } : null,
    );

    await expect(
      service.create("user-1", { kind: "ABOUT_ME", label: "  city   POP " }),
    ).rejects.toMatchObject(ERROR_CODES("ATTRIBUTE_EXISTS"));
  });

  it("maps a Prisma P2002 race onto the same stable conflict error", async () => {
    const { prisma, service } = makeService();
    prisma.userAttribute.create.mockRejectedValue({ code: "P2002" });

    await expect(service.create("user-1", { kind: "ABOUT_ME", label: "City Pop" })).rejects.toMatchObject(
      ERROR_CODES("ATTRIBUTE_EXISTS"),
    );
  });

  it("rejects a kind outside the enum without touching the database", async () => {
    const { prisma, service } = makeService();
    await expect(
      service.create("user-1", { kind: "SOMETHING_ELSE" as never, label: "x" }),
    ).rejects.toMatchObject(ERROR_CODES("VALIDATION_ERROR"));
    expect(prisma.userAttribute.count).not.toHaveBeenCalled();
  });

  it("rejects an empty custom label", async () => {
    const { service } = makeService();
    await expect(service.create("user-1", { kind: "ABOUT_ME", label: "   " })).rejects.toMatchObject(
      ERROR_CODES("VALIDATION_ERROR"),
    );
  });

  it("enforces the SYSTEM / CUSTOM invariant: definitionId and label are exclusive", async () => {
    const { prisma, service } = makeService();
    await expect(
      service.create("user-1", { kind: "LOOKING_FOR", definitionId: "def-1", label: "Mine" }),
    ).rejects.toMatchObject(ERROR_CODES("VALIDATION_ERROR"));
    expect(prisma.attributeDefinition.findUnique).not.toHaveBeenCalled();
    expect(prisma.userAttribute.create).not.toHaveBeenCalled();
  });

  it("rejects an unknown definition id", async () => {
    const { prisma, service } = makeService();
    prisma.attributeDefinition.findUnique.mockResolvedValue(null);

    await expect(
      service.create("user-1", { kind: "LOOKING_FOR", definitionId: "def-missing" }),
    ).rejects.toMatchObject(ERROR_CODES("VALIDATION_ERROR"));
    expect(prisma.userAttribute.create).not.toHaveBeenCalled();
  });

  it("refuses to select a retired (isActive:false) system tag", async () => {
    const { prisma, service } = makeService();
    prisma.attributeDefinition.findUnique.mockResolvedValue(definition({ isActive: false }));

    await expect(
      service.create("user-1", { kind: "LOOKING_FOR", definitionId: "def-1" }),
    ).rejects.toMatchObject(ERROR_CODES("VALIDATION_ERROR"));
    expect(prisma.userAttribute.create).not.toHaveBeenCalled();
  });

  it("rejects a definition whose kind does not match the request", async () => {
    const { prisma, service } = makeService();
    prisma.attributeDefinition.findUnique.mockResolvedValue(definition({ kind: "ABOUT_ME" }));

    await expect(
      service.create("user-1", { kind: "LOOKING_FOR", definitionId: "def-1" }),
    ).rejects.toMatchObject(ERROR_CODES("VALIDATION_ERROR"));
  });
});

describe("ProfileAttributesService.create (system tags + safety)", () => {
  it("accepts an active system tag and records the SYSTEM shape", async () => {
    const { prisma, service } = makeService();
    prisma.attributeDefinition.findUnique.mockResolvedValue(definition());
    prisma.userAttribute.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "attr-sys",
      definition: definition(),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      ...data,
    }));

    const view = await service.create("user-1", { kind: "LOOKING_FOR", definitionId: "def-1" });

    expect(view.source).toBe("SYSTEM");
    expect(view.label).toBe("Gaming Buddy");
    expect(view.labelZh).toBe("游戏好友");
    expect(view.key).toBe("looking-gaming-buddy");
    expect(view.definitionActive).toBe(true);
    expect(prisma.userAttribute.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ label: null, labelKey: null, definitionId: "def-1" }),
      }),
    );
  });

  it("deduplicates system selections by definitionId", async () => {
    const { prisma, service } = makeService();
    prisma.attributeDefinition.findUnique.mockResolvedValue(definition());
    prisma.userAttribute.findFirst.mockResolvedValue({ id: "existing" });

    await expect(
      service.create("user-1", { kind: "LOOKING_FOR", definitionId: "def-1" }),
    ).rejects.toMatchObject(ERROR_CODES("ATTRIBUTE_EXISTS"));
    expect(prisma.userAttribute.findFirst).toHaveBeenCalledWith({
      where: { userId: "user-1", definitionId: "def-1" },
    });
  });

  it("rejects a HIGH safety scan before writing", async () => {
    const safety = makeSafety({ level: "HIGH", reasons: ["疑似投资诈骗"] });
    const { prisma, service } = makeService(makePrisma(), safety);

    await expect(
      service.create("user-1", { kind: "ABOUT_ME", label: "Guaranteed return" }),
    ).rejects.toMatchObject(ERROR_CODES("MESSAGE_BLOCKED"));
    expect(safety.scanText).toHaveBeenCalledWith("Guaranteed return");
    expect(prisma.userAttribute.create).not.toHaveBeenCalled();
  });

  it("rejects a blocked safety scan before writing", async () => {
    const safety = makeSafety({ blocked: true, level: "MEDIUM" });
    const { service } = makeService(makePrisma(), safety);

    await expect(service.create("user-1", { kind: "ABOUT_ME", label: "nope" })).rejects.toMatchObject(
      ERROR_CODES("MESSAGE_BLOCKED"),
    );
  });

  it("scans the value as well as the label", async () => {
    // The scan short-circuits on the first block, so the label is benign here and
    // only the value trips the filter. Mocking it that way is what makes this test
    // prove the value path was scanned at all.
    const safety = {
      scanText: jest.fn((text: string) =>
        text === "payload" ? { ...LOW_SCAN, blocked: true } : { ...LOW_SCAN },
      ),
    };
    const { service, prisma } = makeService(makePrisma(), safety);

    await expect(
      service.create("user-1", { kind: "ABOUT_ME", label: "Safe", value: "payload" }),
    ).rejects.toMatchObject(ERROR_CODES("MESSAGE_BLOCKED"));
    expect(safety.scanText).toHaveBeenCalledWith("Safe");
    expect(safety.scanText).toHaveBeenCalledWith("payload");
    expect(prisma.userAttribute.create).not.toHaveBeenCalled();
  });

  it("derives labelKey and reviewStatus server-side even if the caller smuggles them", async () => {
    const { prisma, service } = makeService();
    await service.create("user-1", {
      kind: "ABOUT_ME",
      label: "City Pop",
      ...({ labelKey: "forged", reviewStatus: "HIDDEN" } as object),
    });

    expect(prisma.userAttribute.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ labelKey: "city pop", reviewStatus: "APPROVED" }),
      }),
    );
  });
});

describe("ProfileAttributesService.update", () => {
  const owned = { id: ATTRIBUTE_ID, definitionId: null, kind: "ABOUT_ME" };

  it("rejects an id that is not a UUID without querying the database", async () => {
    const { prisma, service } = makeService();
    await expect(service.update("user-1", "not-a-uuid", { value: "x" })).rejects.toMatchObject(
      ERROR_CODES("ATTRIBUTE_NOT_FOUND"),
    );
    expect(prisma.userAttribute.findFirst).not.toHaveBeenCalled();
  });

  it("does not update another user's attribute", async () => {
    const { prisma, service } = makeService();
    prisma.userAttribute.findFirst.mockResolvedValue(null);

    await expect(service.update("user-1", ATTRIBUTE_ID, { value: "hijack" })).rejects.toMatchObject(
      ERROR_CODES("ATTRIBUTE_NOT_FOUND"),
    );
    expect(prisma.userAttribute.findFirst).toHaveBeenCalledWith({
      where: { id: ATTRIBUTE_ID, userId: "user-1" },
    });
    expect(prisma.userAttribute.update).not.toHaveBeenCalled();
  });

  it("updates visibility and sort order on an owned row", async () => {
    const { prisma, service } = makeService();
    prisma.userAttribute.findFirst.mockResolvedValue(owned);

    const view = await service.update("user-1", ATTRIBUTE_ID, {
      visibility: "CONNECTIONS",
      sortOrder: 5,
    });

    expect(view.visibility).toBe("CONNECTIONS");
    expect(prisma.userAttribute.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ATTRIBUTE_ID },
        data: { visibility: "CONNECTIONS", sortOrder: 5 },
      }),
    );
  });

  it("refuses to rename a system tag", async () => {
    const { prisma, service } = makeService();
    prisma.userAttribute.findFirst.mockResolvedValue({ ...owned, definitionId: "def-1" });

    await expect(service.update("user-1", ATTRIBUTE_ID, { label: "Renamed" })).rejects.toMatchObject(
      ERROR_CODES("VALIDATION_ERROR"),
    );
    expect(prisma.userAttribute.update).not.toHaveBeenCalled();
  });

  it("recomputes labelKey when a custom label is renamed and rejects collisions", async () => {
    const { prisma, service } = makeService();
    prisma.userAttribute.findFirst
      .mockResolvedValueOnce(owned)
      .mockResolvedValueOnce({ id: "other" });

    await expect(service.update("user-1", ATTRIBUTE_ID, { label: "City  POP" })).rejects.toMatchObject(
      ERROR_CODES("ATTRIBUTE_EXISTS"),
    );
    expect(prisma.userAttribute.findFirst).toHaveBeenLastCalledWith({
      where: { userId: "user-1", kind: "ABOUT_ME", labelKey: "city pop", NOT: { id: ATTRIBUTE_ID } },
    });
    expect(prisma.userAttribute.update).not.toHaveBeenCalled();
  });

  it("rejects an empty update payload", async () => {
    const { prisma, service } = makeService();
    prisma.userAttribute.findFirst.mockResolvedValue(owned);

    await expect(service.update("user-1", ATTRIBUTE_ID, {})).rejects.toMatchObject(
      ERROR_CODES("VALIDATION_ERROR"),
    );
    expect(prisma.userAttribute.update).not.toHaveBeenCalled();
  });

  it("scans renamed labels with the safety service", async () => {
    const safety = makeSafety({ level: "HIGH" });
    const { prisma, service } = makeService(makePrisma(), safety);
    prisma.userAttribute.findFirst.mockResolvedValue(owned);

    await expect(service.update("user-1", ATTRIBUTE_ID, { label: "Casino" })).rejects.toMatchObject(
      ERROR_CODES("MESSAGE_BLOCKED"),
    );
    expect(prisma.userAttribute.update).not.toHaveBeenCalled();
  });
});

describe("ProfileAttributesService.remove", () => {
  it("deletes an owned attribute", async () => {
    const { prisma, service } = makeService();
    prisma.userAttribute.findFirst.mockResolvedValue({ id: ATTRIBUTE_ID });

    await expect(service.remove("user-1", ATTRIBUTE_ID)).resolves.toEqual({ ok: true });
    expect(prisma.userAttribute.delete).toHaveBeenCalledWith({ where: { id: ATTRIBUTE_ID } });
  });

  it("scopes the lookup to the caller so a foreign id cannot be deleted", async () => {
    const { prisma, service } = makeService();
    prisma.userAttribute.findFirst.mockResolvedValue(null);

    await expect(service.remove("user-1", ATTRIBUTE_ID)).rejects.toMatchObject(
      ERROR_CODES("ATTRIBUTE_NOT_FOUND"),
    );
    expect(prisma.userAttribute.findFirst).toHaveBeenCalledWith({
      where: { id: ATTRIBUTE_ID, userId: "user-1" },
      select: { id: true },
    });
    expect(prisma.userAttribute.delete).not.toHaveBeenCalled();
  });

  it("rejects a malformed id without querying the database", async () => {
    const { prisma, service } = makeService();
    await expect(service.remove("user-1", "abc")).rejects.toMatchObject(
      ERROR_CODES("ATTRIBUTE_NOT_FOUND"),
    );
    expect(prisma.userAttribute.delete).not.toHaveBeenCalled();
  });
});

describe("ProfileAttributesService field visibility", () => {
  it("materialises the default tier for every whitelisted key", async () => {
    const { service } = makeService();
    const rows = await service.listFieldVisibility("user-1");

    expect(PROFILE_VISIBILITY_FIELD_WHITELIST).toHaveLength(13);
    expect(rows.map((row) => row.fieldKey)).toEqual([...PROFILE_VISIBILITY_FIELD_WHITELIST]);
    expect(rows.every((row) => row.visibility === "PUBLIC")).toBe(true);
  });

  it("rejects an unknown fieldKey instead of creating a junk row", async () => {
    const { prisma, service } = makeService();
    await expect(service.setFieldVisibility("user-1", "email", "PRIVATE")).rejects.toMatchObject(
      ERROR_CODES("VALIDATION_ERROR"),
    );
    expect(prisma.profileFieldVisibility.upsert).not.toHaveBeenCalled();
    expect(prisma.profileFieldVisibility.deleteMany).not.toHaveBeenCalled();
  });

  it("stores a non-default tier lazily", async () => {
    const { prisma, service } = makeService();
    await service.setFieldVisibility("user-1", "bio", "CONNECTIONS");

    expect(prisma.profileFieldVisibility.upsert).toHaveBeenCalledWith({
      where: { userId_fieldKey: { userId: "user-1", fieldKey: "bio" } },
      create: { userId: "user-1", fieldKey: "bio", visibility: "CONNECTIONS" },
      update: { visibility: "CONNECTIONS" },
    });
  });

  it("deletes the row instead of storing a redundant default", async () => {
    const { prisma, service } = makeService();
    await service.setFieldVisibility("user-1", "region", "PUBLIC");

    expect(prisma.profileFieldVisibility.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", fieldKey: "region" },
    });
    expect(prisma.profileFieldVisibility.upsert).not.toHaveBeenCalled();
  });
});
