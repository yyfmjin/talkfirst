import { NotificationService } from "./notification.service";
import { NOTIFICATION_LIMITS, NOTIFICATION_TARGET_TYPES, NOTIFICATION_TYPES } from "./notification.types";

/**
 * PC-3.1b — the notification boundary itself.
 *
 * Two properties are the whole reason this class exists, and neither is visible
 * from a caller's point of view:
 *
 *   1. **It never fails its caller.** Core business (a connection, an exchange,
 *      a comment) must survive a broken notification, so every path resolves —
 *      a bad payload is logged and skipped, a database error is swallowed.
 *   2. **`data` is always a valid envelope.** The column is `VarChar(2000)`, so
 *      an over-long payload is trimmed by *dropping fields and re-encoding*,
 *      never by slicing the encoded string, which can produce unparseable JSON.
 *
 * `notification.create` is the assertion surface: the row handed to it is the
 * row that would reach PostgreSQL.
 */

type Created = {
  userId: string;
  type: string;
  title: string;
  body: string | null;
  data: string | null;
};

function makeService(create?: jest.Mock) {
  const rows: Created[] = [];
  const notificationCreate =
    create ??
    jest.fn(async (args: { data: Created }) => {
      rows.push(args.data);
      return args.data;
    });
  const service = new NotificationService({ notification: { create: notificationCreate } } as never);
  return { service, rows, notificationCreate };
}

const envelope = (row: Created) => JSON.parse(row.data ?? "null") as Record<string, unknown>;

describe("NotificationService.notify — the frozen type set", () => {
  it("1. a known type is written with explicit fields", async () => {
    const { service, rows, notificationCreate } = makeService();

    await service.notify({
      userId: "u-1",
      type: "MOMENT_LIKE",
      title: "你的动态收到点赞",
      body: "hi",
      data: { actorId: "u-2", targetType: "MOMENT", targetId: "m-1", momentId: "m-1" },
    });

    expect(notificationCreate).toHaveBeenCalledTimes(1);
    // Explicit projection: `userId` is the recipient, and the row names every
    // column rather than spreading caller input.
    expect(Object.keys(notificationCreate.mock.calls[0][0].data).sort()).toEqual([
      "body",
      "data",
      "title",
      "type",
      "userId",
    ]);
    expect(rows[0].userId).toBe("u-1");
    expect(rows[0].type).toBe("MOMENT_LIKE");
    expect(rows[0].title).toBe("你的动态收到点赞");
    expect(rows[0].body).toBe("hi");
  });

  it("2. every frozen type is accepted", async () => {
    for (const type of NOTIFICATION_TYPES) {
      const { service, notificationCreate } = makeService();
      await service.notify({ userId: "u-1", type, title: "t" });
      expect(notificationCreate).toHaveBeenCalledTimes(1);
    }
  });

  it("3. an unknown type is refused before it reaches the database", async () => {
    const { service, notificationCreate } = makeService();
    await service.notify({ userId: "u-1", type: "NOT_A_TYPE" as never, title: "t" });
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it("4. a missing recipient is skipped", async () => {
    const { service, notificationCreate } = makeService();
    await service.notify({ userId: "", type: "MOMENT_LIKE", title: "t" });
    expect(notificationCreate).not.toHaveBeenCalled();
  });
});

describe("NotificationService.notify — self suppression", () => {
  it("5. the actor is not told about their own action", async () => {
    const { service, notificationCreate } = makeService();
    await service.notify({
      userId: "u-1",
      type: "MOMENT_LIKE",
      title: "t",
      data: { actorId: "u-1", targetType: "MOMENT", targetId: "m-1" },
    });
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it("6. a missing actor is not a match — the notification still goes out", async () => {
    const { service, rows } = makeService();
    await service.notify({
      userId: "u-1",
      type: "REPORT_REVIEW",
      title: "t",
      data: { targetType: "REPORT", targetId: "r-1" },
    });
    expect(rows).toHaveLength(1);
    expect(envelope(rows[0])).toEqual({ targetType: "REPORT", targetId: "r-1" });
  });

  it("7. an empty-string actor is treated as absent, not as a match", async () => {
    const { service, rows } = makeService();
    await service.notify({
      userId: "u-1",
      type: "MOMENT_LIKE",
      title: "t",
      data: { actorId: "", targetType: "MOMENT", targetId: "m-1" },
    });
    expect(rows).toHaveLength(1);
    expect(envelope(rows[0])).not.toHaveProperty("actorId");
  });
});

describe("NotificationService.notify — the data envelope", () => {
  it("8. actorId, targetType, targetId and the typed extras are all preserved", async () => {
    const { service, rows } = makeService();
    await service.notify({
      userId: "u-1",
      type: "MOMENT_COMMENT",
      title: "t",
      data: {
        actorId: "u-2",
        targetType: "MOMENT",
        targetId: "m-1",
        momentId: "m-1",
        commentId: "c-1",
      },
    });

    expect(envelope(rows[0])).toEqual({
      actorId: "u-2",
      targetType: "MOMENT",
      targetId: "m-1",
      momentId: "m-1",
      commentId: "c-1",
    });
  });

  it("9. every frozen target type is accepted, and an unknown one is not stored", async () => {
    for (const targetType of NOTIFICATION_TARGET_TYPES) {
      const { service, rows } = makeService();
      await service.notify({
        userId: "u-1",
        type: "MOMENT_LIKE",
        title: "t",
        data: { targetType, targetId: "x-1" },
      });
      expect(envelope(rows[0]).targetType).toBe(targetType);
    }

    const { service, rows } = makeService();
    await service.notify({
      userId: "u-1",
      type: "MOMENT_LIKE",
      title: "t",
      data: { targetType: "NOT_A_TARGET" as never, targetId: "x-1" },
    });
    // The notification still goes out — losing it over its metadata would be
    // the worse failure — but the unknown value is not persisted.
    expect(rows).toHaveLength(1);
    expect(envelope(rows[0])).not.toHaveProperty("targetType");
  });

  it("10. no data means a null column, not the string 'undefined'", async () => {
    const { service, rows } = makeService();
    await service.notify({ userId: "u-1", type: "MOMENT_LIKE", title: "t" });
    expect(rows[0].data).toBeNull();
  });
});

describe("NotificationService.notify — length limits", () => {
  it("11. an over-long title is truncated, not rejected", async () => {
    const { service, rows } = makeService();
    await service.notify({ userId: "u-1", type: "MOMENT_LIKE", title: "a".repeat(400) });
    expect(rows[0].title).toHaveLength(NOTIFICATION_LIMITS.title);
  });

  it("12. an over-long body is truncated, not rejected", async () => {
    const { service, rows } = makeService();
    await service.notify({ userId: "u-1", type: "MOMENT_LIKE", title: "t", body: "b".repeat(900) });
    expect(rows[0].body).toHaveLength(NOTIFICATION_LIMITS.body);
  });

  it("13. truncation never leaves a lone surrogate behind", async () => {
    const { service, rows } = makeService();
    // 127 ASCII chars then an emoji whose surrogate pair straddles the cut.
    await service.notify({ userId: "u-1", type: "MOMENT_LIKE", title: "a".repeat(127) + "😀" });
    const stored = rows[0].title;
    expect(stored.length).toBeLessThanOrEqual(NOTIFICATION_LIMITS.title);
    const last = stored.charCodeAt(stored.length - 1);
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
  });

  it("14. an over-long data payload is trimmed by dropping fields and stays valid JSON", async () => {
    const { service, rows } = makeService();
    const extras: Record<string, string> = {};
    for (let i = 0; i < 40; i += 1) extras[`extra${i}`] = "x".repeat(100);

    await service.notify({
      userId: "u-1",
      type: "MOMENT_COMMENT",
      title: "t",
      data: { actorId: "u-2", targetType: "MOMENT", targetId: "m-1", ...extras },
    });

    expect(rows[0].data!.length).toBeLessThanOrEqual(NOTIFICATION_LIMITS.data);
    // Not a sliced fragment: it parses, the envelope survived, and what remains
    // is a strict subset of what was offered — nothing was invented.
    expect(() => JSON.parse(rows[0].data!)).not.toThrow();
    expect(envelope(rows[0])).toMatchObject({ actorId: "u-2", targetType: "MOMENT", targetId: "m-1" });
    const stored = Object.keys(envelope(rows[0]));
    expect(stored.every((k) => k === "actorId" || k === "targetType" || k === "targetId" || k in extras)).toBe(true);
    expect(stored.length).toBeLessThan(43);
  });

  it("15. an envelope too large even as an identifier is shortened, not sliced away", async () => {
    const { service, rows } = makeService();
    await service.notify({
      userId: "u-1",
      type: "MOMENT_COMMENT",
      title: "t",
      data: { targetType: "MOMENT", targetId: "y".repeat(3000) },
    });
    expect(rows).toHaveLength(1);
    // The final fallback shortens the identifier until the envelope fits; the
    // stored value parses and keeps the target type.
    expect(rows[0].data!.length).toBeLessThanOrEqual(NOTIFICATION_LIMITS.data);
    const stored = envelope(rows[0]);
    expect(stored.targetType).toBe("MOMENT");
    expect((stored.targetId as string).length).toBeLessThan(3000);
  });
});

describe("NotificationService.notify — failure behaviour", () => {
  it("16. a database error never reaches the caller", async () => {
    const create = jest.fn(async () => {
      throw new Error("notification table unavailable");
    });
    const { service } = makeService(create);
    await expect(
      service.notify({ userId: "u-1", type: "MOMENT_LIKE", title: "t" }),
    ).resolves.toBeUndefined();
  });

  it("17. a failure is logged so the gap is visible", async () => {
    const create = jest.fn(async () => {
      throw new Error("boom");
    });
    const { service } = makeService(create);
    const warn = jest.spyOn(
      (service as unknown as { logger: { warn: (m: string) => void } }).logger,
      "warn",
    );
    await service.notify({ userId: "u-1", type: "MOMENT_LIKE", title: "t" });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("boom"));
    warn.mockRestore();
  });

  it("18. the actor's own action is not written but is also not an error", async () => {
    const { service, notificationCreate } = makeService();
    await expect(
      service.notify({
        userId: "u-1",
        type: "MOMENT_LIKE",
        title: "t",
        data: { actorId: "u-1", targetType: "MOMENT", targetId: "m-1" },
      }),
    ).resolves.toBeUndefined();
    expect(notificationCreate).not.toHaveBeenCalled();
  });
});
