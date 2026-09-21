import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { CHAT_EMAILS, resolveChatFixture, type ChatFixture } from "../fixtures/chat";
import { connectChatPeer } from "../fixtures/chat-peer";
import { loginAndLand } from "../fixtures/browser";

/**
 * PC-3.3 — chat realtime connection behaviour.
 *
 * These are regression tests for a reconnect storm: the chat screen used to
 * open roughly **50 socket handshakes and 50 token refreshes per second**. Two
 * defects combined to produce it —
 *
 *  1. the client's `error` handler refreshed and called `connect()` again with
 *     no delay, no attempt limit and no coordination with Socket.IO's own retry
 *     loop, so a single rejection became an infinite loop; and
 *  2. the server processed `conversation.join` *before* its asynchronous
 *     `handleConnection` had stored the authenticated user, so a perfectly
 *     valid socket was rejected with `UNAUTHORIZED` and force-disconnected.
 *
 * A healthy connection therefore has to prove two things: exactly one handshake
 * per page, and no second handshake while that one is alive.
 */

const SOCKET_URL_MARK = "socket.io";

/** Records every socket.io WebSocket the page opens, with a timestamp. */
function trackSocketOpens(page: Page): number[] {
  const opens: number[] = [];
  page.on("websocket", (socket) => {
    if (socket.url().includes(SOCKET_URL_MARK)) opens.push(Date.now());
  });
  return opens;
}

/** Every access-token refresh the page issued — the storm's other signature. */
function trackRefreshes(page: Page): string[] {
  const refreshes: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/auth/refresh")) refreshes.push(request.url());
  });
  return refreshes;
}

let fixture: ChatFixture;

test.beforeAll(async () => {
  fixture = await resolveChatFixture();
});

async function openChat(page: Page) {
  await loginAndLand(page, CHAT_EMAILS.alice);
  await page.goto(`/messages/${fixture.conversationId}`);
  await expect(page.getByText("实时连接")).toBeVisible({ timeout: 20_000 });
}

test("首次进入聊天页只创建一个 Socket，并稳定进入“实时连接”", async ({ page }) => {
  await loginAndLand(page, CHAT_EMAILS.alice);
  const opens = trackSocketOpens(page);
  const refreshes = trackRefreshes(page);

  await page.goto(`/messages/${fixture.conversationId}`);
  await expect(page.getByText("实时连接")).toBeVisible({ timeout: 20_000 });

  // Well past the window the old loop needed to produce ~250 handshakes.
  await page.waitForTimeout(6_000);

  expect(opens).toHaveLength(1);
  expect(refreshes).toEqual([]);
  // The connection is still the original one, not a retry that settled.
  await expect(page.getByText("实时连接")).toBeVisible();
});

test("已连接后不会再 connect，5 秒内没有连续 reconnect", async ({ page }) => {
  await loginAndLand(page, CHAT_EMAILS.alice);
  const opens = trackSocketOpens(page);
  await page.goto(`/messages/${fixture.conversationId}`);
  await expect(page.getByText("实时连接")).toBeVisible({ timeout: 20_000 });

  const connectedAt = opens.length;
  await page.waitForTimeout(5_000);

  expect(opens.length).toBe(connectedAt);
  await expect(page.getByText(/连接断开|连接失败/)).toHaveCount(0);
});

test("刷新页面不会叠加 Socket 或 listener", async ({ page }) => {
  await loginAndLand(page, CHAT_EMAILS.alice);
  const opens = trackSocketOpens(page);
  await page.goto(`/messages/${fixture.conversationId}`);
  await expect(page.getByText("实时连接")).toBeVisible({ timeout: 20_000 });
  expect(opens).toHaveLength(1);

  await page.reload();
  await expect(page.getByText("实时连接")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3_000);

  // One socket per document: a listener that survived the reload would show up
  // either as an extra socket or as a duplicated message below.
  expect(opens).toHaveLength(2);

  const peer = await connectChatPeer(CHAT_EMAILS.bob, fixture.conversationId);
  try {
    const body = `PW33 relay ${Date.now()}`;
    await peer.send(body);
    // Exactly one bubble: two listeners would render the message twice.
    await expect(page.getByText(body)).toHaveCount(1);
  } finally {
    peer.close();
  }
});

test("离开聊天页后不再重连", async ({ page }) => {
  await openChat(page);
  const opens = trackSocketOpens(page);

  await page.goto("/messages");
  const before = opens.length;
  await page.waitForTimeout(5_000);

  expect(opens.length).toBe(before);
});

test("连接断开后进入重连状态，恢复后回到“实时连接”并停止重试", async ({ page }) => {
  await loginAndLand(page, CHAT_EMAILS.alice);

  // `context.setOffline(true)` leaves an already-open WebSocket alone in
  // Chromium, so a real drop is simulated at the transport instead: each
  // connection is routed through the real server until the test cuts it.
  let blocked = false;
  let attempts = 0;
  let live: WebSocketRoute | null = null;
  await page.routeWebSocket(/socket\.io/, (ws) => {
    attempts += 1;
    if (blocked) {
      ws.close();
      return;
    }
    live = ws;
    ws.connectToServer();
  });

  await page.goto(`/messages/${fixture.conversationId}`);
  await expect(page.getByText("实时连接")).toBeVisible({ timeout: 20_000 });
  expect(attempts).toBe(1);

  blocked = true;
  (live as WebSocketRoute | null)?.close();
  await expect(page.getByText("连接断开，正在重连…")).toBeVisible({ timeout: 20_000 });

  // Five seconds down. The old code managed roughly 250 handshakes in this
  // window; bounded exponential backoff allows a handful.
  const beforeWait = attempts;
  await page.waitForTimeout(5_000);
  expect(attempts - beforeWait).toBeLessThanOrEqual(5);

  blocked = false;
  await expect(page.getByText("实时连接")).toBeVisible({ timeout: 30_000 });

  // Recovered: retrying stops rather than continuing to churn.
  const afterRecovery = attempts;
  await page.waitForTimeout(5_000);
  expect(attempts).toBe(afterRecovery);
});

test("“对方在线”不随本端连接状态变化", async ({ page }) => {
  // Bob has to be online for the badge to have an opinion at all.
  const peer = await connectChatPeer(CHAT_EMAILS.bob, fixture.conversationId);
  try {
    let blocked = false;
    let live: WebSocketRoute | null = null;
    await page.routeWebSocket(/socket\.io/, (ws) => {
      if (blocked) {
        ws.close();
        return;
      }
      live = ws;
      ws.connectToServer();
    });

    await openChat(page);
    await expect(page.getByText("🟢 对方在线")).toBeVisible({ timeout: 20_000 });

    blocked = true;
    (live as WebSocketRoute | null)?.close();
    await expect(page.getByText("连接断开，正在重连…")).toBeVisible({ timeout: 20_000 });

    // Our connection dropped, but that says nothing about whether Bob is online.
    await expect(page.getByText("🟢 对方在线")).toBeVisible();
    await expect(page.getByText("连接失败")).toHaveCount(0);

    blocked = false;
    await expect(page.getByText("实时连接")).toBeVisible({ timeout: 30_000 });
  } finally {
    peer.close();
  }
});
