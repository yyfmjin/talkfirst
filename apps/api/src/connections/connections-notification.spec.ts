import { ConnectionsService } from "./connections.service";
import { NotificationService } from "../notifications/notification.service";

/**
 * PC-3.1b — the two connection notifications, after the move to the single
 * `NotificationService`.
 *
 * Three properties are worth pinning, because the migration could silently
 * break any of them:
 *
 *   1. **The envelope is new; the message is not.** `type`, `title`, `body` and
 *      the pre-existing `data` keys are unchanged, and `actorId` / `targetType` /
 *      `targetId` are added around them.
 *   2. **`REQUEST_ACCEPTED` leaves the transaction.** It used to be written
 *      through `tx.notification.create`, which made a connection hostage to a
 *      notification insert. It is now written after the commit — so the
 *      transaction client is never asked for a notification at all.
 *   3. **A failed notification does not fail the connection.** `notify` never
 *      throws, so an accepted request still returns its conversation.
 */

const SENDER = "a1b2c3d4-0000-4000-8000-000000000001";
const RECEIVER = "a1b2c3d4-0000-4000-8000-000000000002";
const REQUEST_ID = "a1b2c3d4-0000-4000-8000-000000000003";
const CONNECTION_ID = "a1b2c3d4-0000-4000-8000-000000000004";
const CONVERSATION_ID = "a1b2c3d4-0000-4000-8000-000000000005";

const SENDER_ROW = { id: SENDER, nickname: "Ann", avatarUrl: null, countryCode: "CN" };

type NotificationRow = {
  userId: string;
  type: string;
  title: string;
  body: string | null;
  data: string | null;
};

function makeHarness() {
  const notificationRows: NotificationRow[] = [];

  const requestRow = {
    id: REQUEST_ID,
    senderId: SENDER,
    receiverId: RECEIVER,
    message: null,
    status: "PENDING",
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    sender: SENDER_ROW,
  };

  const tx = {
    connectionRequest: {
      count: jest.fn(async () => 0),
      findFirst: jest.fn(async () => null),
      create: jest.fn(async () => requestRow),
      update: jest.fn(async () => ({ ...requestRow, status: "ACCEPTED" })),
      updateMany: jest.fn(async () => ({ count: 1 })),
      findUniqueOrThrow: jest.fn(async () => ({ ...requestRow, status: "ACCEPTED" })),
    },
    connection: {
      findFirst: jest.fn(async () => null),
      upsert: jest.fn(async () => ({
        id: CONNECTION_ID,
        status: "ACTIVE",
        createdAt: new Date("2026-09-02T00:00:00.000Z"),
      })),
    },
    conversation: { create: jest.fn(async () => ({ id: CONVERSATION_ID })) },
    conversationMember: { createMany: jest.fn(async () => ({ count: 2 })) },
    message: { create: jest.fn(async () => ({ id: "msg-1" })) },
    // The migration's point: the transaction must never write a notification.
    notification: {
      create: jest.fn(async () => {
        throw new Error("a notification must not be written inside the transaction");
      }),
    },
  };

  const prisma = {
    user: { findUnique: jest.fn(async () => ({ id: RECEIVER, status: "ACTIVE" })) },
    block: { findFirst: jest.fn(async () => null) },
    connectionRequest: {
      count: jest.fn(async () => 0),
      findUnique: jest.fn(async () => ({ ...requestRow, sender: undefined })),
      findFirst: jest.fn(async () => null),
      update: jest.fn(async () => ({ ...requestRow, status: "REJECTED" })),
    },
    notification: {
      create: jest.fn(async (args: { data: NotificationRow }) => {
        notificationRows.push(args.data);
        return args.data;
      }),
    },
    $transaction: jest.fn(async (cb: (client: unknown) => Promise<unknown>) => cb(tx)),
  };

  const safety = {
    scanText: jest.fn(() => ({ level: "LOW", blocked: false, reasons: [] })),
    sayHelloLimit: jest.fn(async () => 20),
    recordAutoFlag: jest.fn(async () => undefined),
  };

  const service = new ConnectionsService(
    prisma as never,
    safety as never,
    new NotificationService(prisma as never),
  );
  return { service, prisma, tx, safety, notificationRows };
}

const envelope = (row: NotificationRow) => JSON.parse(row.data ?? "null") as Record<string, unknown>;

describe("ConnectionsService — SAY_HELLO", () => {
  it("notifies the receiver with the frozen envelope", async () => {
    const { service, notificationRows } = makeHarness();

    await service.sendRequest(SENDER, RECEIVER, "hi there");

    expect(notificationRows).toHaveLength(1);
    expect(notificationRows[0].userId).toBe(RECEIVER);
    expect(notificationRows[0].type).toBe("SAY_HELLO");
    expect(notificationRows[0].title).toBe("Ann said hello");
    expect(notificationRows[0].body).toBe("hi there");
    expect(envelope(notificationRows[0])).toEqual({
      actorId: SENDER,
      targetType: "CONNECTION",
      targetId: REQUEST_ID,
      requestId: REQUEST_ID,
    });
  });

  it("keeps a template label as the body when no message was written", async () => {
    const { service, notificationRows } = makeHarness();
    await service.sendRequest(SENDER, RECEIVER, undefined, "gaming");
    expect(notificationRows[0].body).toBe("🎮 We both like gaming.");
  });
});

describe("ConnectionsService — REQUEST_ACCEPTED", () => {
  it("notifies the sender, and writes outside the transaction", async () => {
    const { service, tx, notificationRows, prisma } = makeHarness();

    const result = await service.respond(RECEIVER, REQUEST_ID, "accept");

    expect(result.connection).toMatchObject({ id: CONNECTION_ID, status: "ACTIVE" });
    expect(notificationRows).toHaveLength(1);
    expect(notificationRows[0].userId).toBe(SENDER);
    expect(notificationRows[0].type).toBe("REQUEST_ACCEPTED");
    expect(notificationRows[0].title).toBe("🎉 It's a connection!");
    expect(notificationRows[0].body).toBe("You both want to talk. Start chatting.");

    // The envelope names the conversation that now exists, and the actor is the
    // person who accepted — not the sender who is being told about it.
    expect(envelope(notificationRows[0])).toEqual({
      actorId: RECEIVER,
      targetType: "CONVERSATION",
      targetId: CONVERSATION_ID,
      requestId: REQUEST_ID,
      connectionId: CONNECTION_ID,
      conversationId: CONVERSATION_ID,
    });

    // `tx.notification.create` throws if it is ever reached, so a green run is
    // itself the proof that the write moved out of the transaction.
    expect(tx.notification.create).not.toHaveBeenCalled();
    expect(prisma.$transaction.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.notification.create.mock.invocationCallOrder[0],
    );
  });

  it("a reject notifies nobody", async () => {
    const { service, notificationRows, tx } = makeHarness();
    const result = await service.respond(RECEIVER, REQUEST_ID, "reject");
    expect(result.connection).toBeNull();
    expect(tx.notification.create).not.toHaveBeenCalled();
    expect(notificationRows).toEqual([]);
  });

  it("a failed notification still leaves the connection accepted", async () => {
    const { service, prisma, notificationRows } = makeHarness();
    prisma.notification.create.mockRejectedValueOnce(new Error("notification table unavailable"));

    const result = await service.respond(RECEIVER, REQUEST_ID, "accept");

    expect(result.connection).toMatchObject({ id: CONNECTION_ID });
    expect(notificationRows).toEqual([]);
  });
});
