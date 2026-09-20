import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import passport from "passport";
import { Strategy as PassportStrategyBase } from "passport-strategy";

import { ApiExceptionFilter } from "../common/api-exception.filter";
import { PrismaService } from "../prisma/prisma.service";
import { encodeNotificationCursor } from "./notification-cursor";
import { NotificationsController } from "./notifications.controller";
import { NOTIFICATION_ITEM_SELECT, NotificationsService } from "./notifications.service";

/**
 * PC-3.1d — the notification read API as the *client* sees it.
 *
 * This is an API contract test, not a service unit test. It drives the real
 * `NotificationsController`, the real `NotificationsService`, the real
 * `ValidationPipe`, `NotificationCursorPipe` and `UuidParamPipe`, and the real
 * `ApiExceptionFilter` over real HTTP; only PostgreSQL is replaced, by the
 * smallest fake in `makePrisma` that can answer the queries this endpoint
 * builds.
 *
 * The fake is deliberately strict: `matches` throws on any `where` it does not
 * model, so a query shape this file has never seen fails loudly instead of
 * quietly matching everything. `findMany` also honours `select`, which is what
 * makes the projection assertions bite — a removed `select` returns the raw row
 * and the "no userId" assertion fails.
 */

const VIEWER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";

const BASE_TIME = Date.parse("2026-09-20T12:00:00.000Z");

/**
 * A lowercase-hex UUID whose text order matches its numeric order.
 *
 * PostgreSQL compares a `uuid` column byte-wise, and for canonical lowercase
 * hex those bytes are the text — so ordering by this string in the fake is the
 * order the database would produce, which is what makes the `id DESC`
 * tie-break assertions meaningful.
 */
function uid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

type Row = {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string | null;
  data: string | null;
  readAt: Date | null;
  createdAt: Date;
};

type Where = Record<string, unknown>;

function makeRow(id: string, overrides: Partial<Row> = {}): Row {
  return {
    id,
    userId: VIEWER,
    type: "NEW_MESSAGE",
    title: "t",
    body: null,
    data: null,
    readAt: null,
    createdAt: new Date(BASE_TIME),
    ...overrides,
  };
}

/** `n` unread rows, one second apart, oldest first from `uid(start)`. */
function makeRows(n: number, overrides: Partial<Row> = {}, start = 1): Row[] {
  return Array.from({ length: n }, (_, index) =>
    makeRow(uid(start + index), { createdAt: new Date(BASE_TIME + index * 1000), ...overrides }),
  );
}

function equalTo(value: unknown, bound: unknown): boolean {
  if (bound instanceof Date) return value instanceof Date && value.getTime() === bound.getTime();
  return value === bound;
}

function lessThan(value: unknown, bound: unknown): boolean {
  if (value instanceof Date && bound instanceof Date) return value.getTime() < bound.getTime();
  return String(value) < String(bound);
}

/** The subset of `NotificationWhereInput` this endpoint can build. */
function matches(row: Row, where?: Where): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, condition]) => {
    if (key === "OR") return (condition as Where[]).some((branch) => matches(row, branch));
    if (key === "AND") return (condition as Where[]).every((branch) => matches(row, branch));

    const value = (row as unknown as Record<string, unknown>)[key];
    // A `Date` is an object, so it has to be recognised before the generic
    // operator branch below — otherwise a plain equality condition on
    // `createdAt` would be mistaken for an operator bag.
    if (condition instanceof Date) return equalTo(value, condition);
    if (condition !== null && typeof condition === "object") {
      const bounds = condition as { lt?: unknown };
      if ("lt" in bounds) return lessThan(value, bounds.lt);
      throw new Error(`fake database: unsupported where.${key} = ${JSON.stringify(condition)}`);
    }
    return equalTo(value, condition);
  });
}

function makePrisma() {
  const rows: Row[] = [];

  return {
    rows,
    notification: {
      findMany: jest.fn(
        async (args: {
          where?: Where;
          orderBy?: unknown;
          take?: number;
          select?: Record<string, boolean>;
        }) => {
          const found = rows.filter((row) => matches(row, args.where));
          // Mirrors `orderBy: [{ createdAt: "desc" }, { id: "desc" }]`. The
          // service's real orderBy is asserted separately, so this hardcoded
          // sort cannot hide a wrong clause.
          const ordered = [...found].sort((a, b) => {
            const byDate = b.createdAt.getTime() - a.createdAt.getTime();
            if (byDate !== 0) return byDate;
            return b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
          });
          const page = typeof args.take === "number" ? ordered.slice(0, args.take) : ordered;
          return page.map((row) => {
            if (!args.select) return { ...row };
            const out: Record<string, unknown> = {};
            for (const key of Object.keys(args.select)) {
              if (args.select[key]) out[key] = (row as unknown as Record<string, unknown>)[key];
            }
            return out;
          });
        },
      ),
      count: jest.fn(
        async (args: { where?: Where }) => rows.filter((row) => matches(row, args.where)).length,
      ),
      updateMany: jest.fn(async (args: { where?: Where; data: Partial<Row> }) => {
        const targets = rows.filter((row) => matches(row, args.where));
        for (const target of targets) Object.assign(target, args.data);
        return { count: targets.length };
      }),
    },
  };
}

/** The identity `passport` hands to the guard. `null` is a signed-out caller. */
let currentUser: string | null = VIEWER;

class SwitchableStrategy extends PassportStrategyBase {
  name = "jwt";

  authenticate() {
    if (currentUser) this.success({ id: currentUser, email: "viewer@example.test" });
    else this.fail({ message: "No auth token" }, 401);
  }
}

passport.use("jwt", new SwitchableStrategy());

type Body = {
  success: boolean;
  data?: {
    items?: Array<Record<string, unknown>>;
    unread?: number;
    nextCursor?: string | null;
    read?: boolean;
  };
  error?: { code?: string; message?: string };
};

describe("Notifications API", () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof makePrisma>;
  let base = "";

  beforeAll(async () => {
    prisma = makePrisma();
    const moduleRef = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [NotificationsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.listen(0);
    const url = await app.getUrl();
    base = `http://127.0.0.1:${url.slice(url.lastIndexOf(":") + 1)}/api/v1/notifications`;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.rows.length = 0;
    currentUser = VIEWER;
  });

  afterAll(async () => {
    await app.close();
  });

  const seed = (...rows: Row[]) => prisma.rows.push(...rows);

  async function get(query = "") {
    const response = await fetch(`${base}${query}`);
    return { response, body: (await response.json()) as Body };
  }

  async function patchRead(id: string) {
    const response = await fetch(`${base}/${id}/read`, { method: "PATCH" });
    return { response, body: (await response.json()) as Body };
  }

  async function postReadAll() {
    const response = await fetch(`${base}/read`, { method: "POST" });
    return { response, body: (await response.json()) as Body };
  }

  const ids = (body: Body) => (body.data?.items ?? []).map((item) => item.id as string);

  const cursorFor = (row: Pick<Row, "id" | "createdAt">) =>
    encodeURIComponent(encodeNotificationCursor({ createdAt: row.createdAt, id: row.id }));

  /**
   * Follows `nextCursor` until it comes back `null`. `terminated` is the
   * anti-infinite-loop evidence: a cursor that never ends leaves it false.
   */
  async function walk(query = "") {
    const seen: string[] = [];
    const pages: string[][] = [];
    let cursor: string | null = null;

    for (let step = 0; step < 25; step += 1) {
      const suffix = cursor ? `${query}${query ? "&" : "?"}cursor=${cursor}` : query;
      const { response, body } = await get(suffix);
      expect(response.status).toBe(200);
      const page = ids(body);
      pages.push(page);
      seen.push(...page);
      cursor = body.data?.nextCursor ?? null;
      if (!cursor) return { seen, pages, terminated: true, steps: step + 1 };
    }

    return { seen, pages, terminated: false, steps: 25 };
  }

  describe("GET /notifications — ownership, ordering and projection", () => {
    it("1. JWT 用户只看到自己的通知", async () => {
      seed(
        makeRow(uid(1), { userId: VIEWER }),
        makeRow(uid(2), { userId: OTHER }),
        makeRow(uid(3), { userId: OTHER }),
      );

      const { response, body } = await get();
      expect(response.status).toBe(200);
      expect(ids(body)).toEqual([uid(1)]);
      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: VIEWER }) }),
      );
    });

    it("2. 默认 pageSize=20，映射为 take = pageSize + 1", async () => {
      seed(...makeRows(25));
      const { body } = await get();
      expect(body.data?.items).toHaveLength(20);
      expect(prisma.notification.findMany.mock.calls[0][0].take).toBe(21);
    });

    it("3. pageSize 可自定义", async () => {
      seed(...makeRows(25));
      const { body } = await get("?pageSize=5");
      expect(body.data?.items).toHaveLength(5);
      expect(prisma.notification.findMany.mock.calls[0][0].take).toBe(6);
    });

    it("4. pageSize > 50 收敛为 50（不是错误）", async () => {
      seed(...makeRows(60));
      const { response, body } = await get("?pageSize=500");
      expect(response.status).toBe(200);
      expect(body.data?.items).toHaveLength(50);
      expect(prisma.notification.findMany.mock.calls[0][0].take).toBe(51);
      expect(body.data?.nextCursor).not.toBeNull();
    });

    it("5. pageSize 非法（0 / 负数 / 非数字 / 小数 / 空）-> 400，且从不查询", async () => {
      seed(...makeRows(3));
      const results = [];
      for (const value of ["0", "-1", "abc", "2.5", ""]) {
        const { response, body } = await get(`?pageSize=${value}`);
        results.push({ value, status: response.status, code: body.error?.code });
      }
      expect(results).toEqual([
        { value: "0", status: 400, code: "VALIDATION_ERROR" },
        { value: "-1", status: 400, code: "VALIDATION_ERROR" },
        { value: "abc", status: 400, code: "VALIDATION_ERROR" },
        { value: "2.5", status: 400, code: "VALIDATION_ERROR" },
        { value: "", status: 400, code: "VALIDATION_ERROR" },
      ]);
      expect(prisma.notification.findMany).not.toHaveBeenCalled();
    });

    it("6. 排序契约：createdAt DESC, id DESC", async () => {
      seed(
        makeRow(uid(1), { createdAt: new Date(BASE_TIME) }),
        makeRow(uid(2), { createdAt: new Date(BASE_TIME + 2000) }),
        makeRow(uid(3), { createdAt: new Date(BASE_TIME + 1000) }),
      );

      const { body } = await get();
      expect(ids(body)).toEqual([uid(2), uid(3), uid(1)]);
      expect(prisma.notification.findMany.mock.calls[0][0].orderBy).toEqual([
        { createdAt: "desc" },
        { id: "desc" },
      ]);
    });

    it("7. 同一 createdAt 由 id DESC 稳定定序", async () => {
      seed(makeRow(uid(1)), makeRow(uid(3)), makeRow(uid(2)));
      const { body } = await get();
      expect(ids(body)).toEqual([uid(3), uid(2), uid(1)]);
    });

    it("8. nextCursor：还有下一页时非 null，最后一页为 null", async () => {
      seed(...makeRows(3));
      const first = await get("?pageSize=2");
      expect(first.body.data?.nextCursor).toEqual(expect.any(String));
      const last = await get(`?pageSize=2&cursor=${first.body.data?.nextCursor}`);
      expect(last.body.data?.items).toHaveLength(1);
      expect(last.body.data?.nextCursor).toBeNull();
    });

    it("11. 空列表 -> items []、unread 0、nextCursor null", async () => {
      const { response, body } = await get();
      expect(response.status).toBe(200);
      expect(body.data).toEqual({ items: [], unread: 0, nextCursor: null });
    });

    it("12. unread 是当前用户全部未读数", async () => {
      seed(
        makeRow(uid(1)),
        makeRow(uid(2), { readAt: new Date(BASE_TIME) }),
        makeRow(uid(3)),
        makeRow(uid(4), { userId: OTHER }),
        makeRow(uid(5), { userId: OTHER }),
      );
      const { body } = await get();
      expect(body.data?.unread).toBe(2);
    });

    it("19. 响应不含 userId（显式 select）", async () => {
      seed(makeRow(uid(1), { userId: VIEWER }));
      const { body } = await get();

      expect(body.data?.items?.[0]).not.toHaveProperty("userId");
      expect(Object.keys(body.data?.items?.[0] ?? {}).sort()).toEqual([
        "body",
        "createdAt",
        "data",
        "id",
        "readAt",
        "title",
        "type",
      ]);
      // The recipient id is the one value that must never be echoed back.
      expect(JSON.stringify(body)).not.toContain(VIEWER);

      const args = prisma.notification.findMany.mock.calls[0][0] as {
        select: Record<string, boolean>;
      };
      expect(args.select).toEqual(NOTIFICATION_ITEM_SELECT);
      expect(args.select).not.toHaveProperty("userId");
    });

    it("20. 响应不泄露敏感字段", async () => {
      seed(
        makeRow(uid(1), {
          title: "New message",
          body: "hello",
          data: JSON.stringify({ actorId: ACTOR, targetType: "CONVERSATION", targetId: uid(9) }),
        }),
      );
      const { body } = await get();
      const serialized = JSON.stringify(body);
      for (const field of ["passwordHash", "token", "isAdmin", "refreshToken", "oauth", "email"]) {
        expect(serialized).not.toContain(field);
      }
    });

    it("18. 历史 data（无 envelope / 非 JSON / null）原样返回，不 500", async () => {
      seed(
        makeRow(uid(1), { data: JSON.stringify({ conversationId: uid(9) }) }),
        makeRow(uid(2), { data: "legacy-not-json" }),
        makeRow(uid(3), { data: null }),
      );

      const { response, body } = await get();
      expect(response.status).toBe(200);
      const byId = new Map((body.data?.items ?? []).map((item) => [item.id, item]));
      expect(byId.get(uid(1))?.data).toBe(JSON.stringify({ conversationId: uid(9) }));
      expect(byId.get(uid(2))?.data).toBe("legacy-not-json");
      expect(byId.get(uid(3))?.data).toBeNull();
    });
  });

  describe("GET /notifications — cursor pagination", () => {
    it("9/10. 多页遍历无重复、无遗漏、不死循环", async () => {
      const seeded = makeRows(25);
      seed(...seeded);

      const { seen, pages, terminated, steps } = await walk("?pageSize=10");
      expect(terminated).toBe(true);
      expect(steps).toBe(3);
      expect(pages.map((page) => page.length)).toEqual([10, 10, 5]);
      expect(new Set(seen).size).toBe(25);
      expect([...seen].sort()).toEqual(seeded.map((row) => row.id).sort());
    });

    it("A/B/C 同一 createdAt，pageSize=1 三页各出现一次，不重不漏不循环", async () => {
      const same = new Date(BASE_TIME);
      seed(
        makeRow(uid(1), { createdAt: same }),
        makeRow(uid(2), { createdAt: same }),
        makeRow(uid(3), { createdAt: same }),
      );

      const { seen, pages, terminated, steps } = await walk("?pageSize=1");
      expect(terminated).toBe(true);
      expect(steps).toBe(3);
      expect(pages).toEqual([[uid(3)], [uid(2)], [uid(1)]]);
      expect(seen).toEqual([uid(3), uid(2), uid(1)]);
      expect(new Set(seen).size).toBe(3);
    });

    it("16. cursor 边界是元组比较，且从不使用 skip / offset", async () => {
      seed(makeRow(uid(5)));
      await get(`?cursor=${cursorFor(makeRow(uid(5)))}`);

      const args = prisma.notification.findMany.mock.calls[0][0] as {
        where: Where;
        skip?: unknown;
      };
      expect(args.where).toEqual({
        userId: VIEWER,
        OR: [
          { createdAt: { lt: new Date(BASE_TIME) } },
          { createdAt: new Date(BASE_TIME), id: { lt: uid(5) } },
        ],
      });
      // An offset page re-reads or skips rows whenever the table changes
      // mid-walk; a cursor is the whole point of this endpoint.
      expect(args).not.toHaveProperty("skip");
    });

    it("17. 非法 cursor -> 400（不是 500，也不是静默回到第一页）", async () => {
      seed(...makeRows(3));
      const iso = new Date(BASE_TIME).toISOString();
      const base64 = (value: unknown) =>
        Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

      const candidates = [
        "not-base64-at-all-$$$",
        Buffer.from("not json", "utf8").toString("base64url"),
        base64({}),
        base64([1, 2, 3]),
        base64({ createdAt: "yesterday", id: uid(1) }),
        base64({ createdAt: iso }),
        base64({ createdAt: "2026-09-20", id: uid(1) }),
        base64({ createdAt: iso, id: "not-a-uuid" }),
        "",
      ];

      const results = [];
      for (const value of candidates) {
        const { response, body } = await get(`?cursor=${value}`);
        results.push({ status: response.status, code: body.error?.code });
      }
      expect(results).toEqual(
        candidates.map(() => ({ status: 400, code: "VALIDATION_ERROR" })),
      );
      expect(prisma.notification.findMany).not.toHaveBeenCalled();
    });

    it("游标链中间新增更新的通知，不会造成重复", async () => {
      seed(...makeRows(6));

      const first = await get("?pageSize=2");
      const firstPage = ids(first.body);
      const cursor = first.body.data?.nextCursor as string;

      // Something arrives *newer* than the first page while the client is
      // between pages. It is allowed to be absent from this walk — a cursor
      // makes no promise about concurrent inserts — but it must not make an
      // already-delivered row reappear.
      seed(makeRow(uid(99), { createdAt: new Date(Date.now() + 60_000) }));

      const second = await get(`?pageSize=2&cursor=${cursor}`);
      expect(ids(second.body).some((id) => firstPage.includes(id))).toBe(false);
    });
  });

  describe("GET /notifications — type filter", () => {
    it("13/14. type 过滤只返回该类型", async () => {
      seed(
        makeRow(uid(1), { type: "MOMENT_REPLY" }),
        makeRow(uid(2), { type: "NEW_MESSAGE" }),
        makeRow(uid(3), { type: "MOMENT_REPLY" }),
      );

      expect(ids((await get("?type=MOMENT_REPLY")).body)).toEqual([uid(3), uid(1)]);
      expect(ids((await get("?type=NEW_MESSAGE")).body)).toEqual([uid(2)]);
    });

    it("type 进入 Prisma where，不是取回后再过滤", async () => {
      seed(makeRow(uid(1), { type: "MOMENT_REPLY" }));
      await get("?type=MOMENT_REPLY");
      expect(prisma.notification.findMany.mock.calls[0][0].where).toEqual({
        userId: VIEWER,
        type: "MOMENT_REPLY",
      });
    });

    it("13b. unread 不受 type filter 影响，仍是全部未读", async () => {
      seed(
        makeRow(uid(1), { type: "MOMENT_REPLY" }),
        makeRow(uid(2), { type: "NEW_MESSAGE" }),
        makeRow(uid(3), { type: "NEW_MESSAGE" }),
      );

      const { body } = await get("?type=MOMENT_REPLY");
      expect(ids(body)).toEqual([uid(1)]);
      expect(body.data?.unread).toBe(3);
    });

    it("15. 非法 type -> 400，且从不查询", async () => {
      seed(makeRow(uid(1)));
      const results = [];
      for (const value of ["not-a-type", "moment_reply", "NEW_MESSAGE ", "1"]) {
        const { response, body } = await get(`?type=${encodeURIComponent(value)}`);
        results.push({ status: response.status, code: body.error?.code });
      }
      expect(results).toEqual([
        { status: 400, code: "VALIDATION_ERROR" },
        { status: 400, code: "VALIDATION_ERROR" },
        { status: 400, code: "VALIDATION_ERROR" },
        { status: 400, code: "VALIDATION_ERROR" },
      ]);
      expect(prisma.notification.findMany).not.toHaveBeenCalled();
    });

    it("17b. type 与 cursor 可以组合", async () => {
      seed(
        makeRow(uid(1), { type: "MOMENT_REPLY", createdAt: new Date(BASE_TIME) }),
        makeRow(uid(2), { type: "NEW_MESSAGE", createdAt: new Date(BASE_TIME + 1000) }),
        makeRow(uid(3), { type: "MOMENT_REPLY", createdAt: new Date(BASE_TIME + 2000) }),
      );

      const { seen, terminated } = await walk("?type=MOMENT_REPLY&pageSize=1");
      expect(terminated).toBe(true);
      expect(seen).toEqual([uid(3), uid(1)]);
    });
  });

  describe("PATCH /notifications/:id/read", () => {
    it("21/22. 自己的未读通知 -> 200 read:true，readAt 被写入", async () => {
      const mine = makeRow(uid(1));
      seed(mine);

      const { response, body } = await patchRead(uid(1));
      expect(response.status).toBe(200);
      expect(body).toEqual({ success: true, data: { read: true } });
      expect(mine.readAt).toBeInstanceOf(Date);
    });

    it("23. 再次 read -> 仍成功（幂等）", async () => {
      seed(makeRow(uid(1), { readAt: new Date(BASE_TIME) }));

      const first = await patchRead(uid(1));
      const second = await patchRead(uid(1));
      expect([first.response.status, second.response.status]).toEqual([200, 200]);
      // No `readAt: null` in the where: an already-read row still matches, so a
      // second PATCH is a no-op rather than an error.
      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { id: uid(1), userId: VIEWER },
        data: { readAt: expect.any(Date) },
      });
    });

    it("24. 别人的通知 -> 404，且数据不变（不泄露存在性）", async () => {
      const theirs = makeRow(uid(1), { userId: OTHER });
      seed(theirs);

      const { response, body } = await patchRead(uid(1));
      expect(response.status).toBe(404);
      expect(body.error?.code).toBe("NOTIFICATION_NOT_FOUND");
      expect(theirs.readAt).toBeNull();
      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { id: uid(1), userId: VIEWER },
        data: { readAt: expect.any(Date) },
      });
    });

    it("25. 不存在的通知 -> 404", async () => {
      const { response, body } = await patchRead(uid(404));
      expect(response.status).toBe(404);
      expect(body.error?.code).toBe("NOTIFICATION_NOT_FOUND");
    });

    it("26. 非 UUID -> 400，且从不写库", async () => {
      const { response, body } = await patchRead("not-a-uuid");
      expect(response.status).toBe(400);
      expect(body.error?.code).toBe("VALIDATION_ERROR");
      expect(prisma.notification.updateMany).not.toHaveBeenCalled();
    });

    it("27. 未认证 -> 401 UNAUTHORIZED", async () => {
      currentUser = null;

      const read = await patchRead(uid(1));
      expect(read.response.status).toBe(401);
      expect(read.body.error?.code).toBe("UNAUTHORIZED");

      const list = await get();
      expect(list.response.status).toBe(401);
      expect(list.body.error?.code).toBe("UNAUTHORIZED");
    });

    it("28. read 后 unread 正确减少", async () => {
      seed(...makeRows(3));

      expect((await get()).body.data?.unread).toBe(3);
      await patchRead(uid(1));
      const after = await get();
      expect(after.body.data?.unread).toBe(2);
      expect(after.body.data?.items).toHaveLength(3);
    });

    it("29. 并发 / 重复 read 不报错", async () => {
      seed(makeRow(uid(1)));

      const [first, second] = await Promise.all([patchRead(uid(1)), patchRead(uid(1))]);
      expect([first.response.status, second.response.status]).toEqual([200, 200]);
      expect(prisma.rows[0].readAt).toBeInstanceOf(Date);
    });
  });

  describe("POST /notifications/read", () => {
    it("30. 全部已读，unread 归零", async () => {
      seed(...makeRows(4));

      const { response, body } = await postReadAll();
      expect(response.status).toBe(201);
      expect(body).toEqual({ success: true, data: { read: true } });
      expect(prisma.rows.every((row) => row.readAt instanceof Date)).toBe(true);
      expect((await get()).body.data?.unread).toBe(0);
    });

    it("31. 只影响当前用户", async () => {
      const mine = makeRow(uid(1));
      const theirs = makeRow(uid(2), { userId: OTHER });
      seed(mine, theirs);

      await postReadAll();
      expect(mine.readAt).toBeInstanceOf(Date);
      expect(theirs.readAt).toBeNull();
      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: VIEWER, readAt: null },
        data: { readAt: expect.any(Date) },
      });
    });

    it("32. 重复调用幂等", async () => {
      seed(...makeRows(2));

      const first = await postReadAll();
      const second = await postReadAll();
      expect([first.response.status, second.response.status]).toEqual([201, 201]);
      expect(prisma.notification.updateMany.mock.calls[1][0].where).toEqual({
        userId: VIEWER,
        readAt: null,
      });
    });
  });
});
