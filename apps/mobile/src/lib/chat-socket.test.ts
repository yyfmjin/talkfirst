import {
  appendMessageOnce,
  createChatSocket,
  type ChatSocketLike,
  type ChatConnectionState,
  type SocketMessage,
} from "./chat-socket";

/**
 * 聊天实时连接的**行为**测试（用一个替身 socket 驱动，不需要真服务器）。
 *
 * 这里钉的大多是 web 端踩过的坑（`apps/web/src/lib/chat-socket.ts` 的注释里有
 * 事故记录）：认证失败时不能无限刷新重试、服务端主动断开必须由自己有限次重连、
 * 会话真正建立后才恢复预算。这些分支在真机上极难复现，只能靠替身把它们走一遍。
 */

type Listener = (payload: unknown) => void;

class FakeSocket implements ChatSocketLike {
  auth: Record<string, unknown> = {};
  connected = false;
  connectCalls = 0;
  disconnectCalls = 0;
  readonly emitted: Array<{ event: string; payload?: unknown }> = [];
  private readonly listeners = new Map<string, Listener[]>();

  on(event: string, handler: Listener): void {
    const list = this.listeners.get(event) ?? [];
    list.push(handler);
    this.listeners.set(event, list);
  }

  emit(event: string, payload?: unknown): void {
    this.emitted.push({ event, payload });
  }

  connect(): void {
    this.connectCalls += 1;
  }

  disconnect(): void {
    this.disconnectCalls += 1;
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }

  /** 测试自己驱动的事件。 */
  fire(event: string, payload?: unknown): void {
    for (const handler of [...(this.listeners.get(event) ?? [])]) handler(payload);
  }

  /** 模拟握手成功。 */
  open(): void {
    this.connected = true;
    this.fire("connect");
  }

  eventsOf(event: string): Array<{ event: string; payload?: unknown }> {
    return this.emitted.filter((row) => row.event === event);
  }
}

/** 让 `getToken()` 这类微任务落地。 */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(options: {
  conversationId?: string | null;
  refresh?: () => Promise<boolean>;
  kickDelayMs?: number;
} = {}) {
  const socket = new FakeSocket();
  const states: ChatConnectionState[] = [];
  const messages: SocketMessage[] = [];
  const activities: Array<{ conversationId: string }> = [];
  const errors: string[] = [];
  const refresh = options.refresh ?? jest.fn(async () => true);

  const handle = createChatSocket(
    {
      conversationId: options.conversationId ?? null,
      onMessage: (message) => messages.push(message),
      onActivity: (activity) => activities.push(activity),
      onState: (state) => states.push(state),
      onError: (message) => errors.push(message),
    },
    {
      createSocket: () => socket,
      getToken: async () => "token-1",
      refresh,
      kickDelayMs: options.kickDelayMs,
    },
  );

  return { socket, states, messages, activities, errors, refresh, handle };
}

const row = (overrides: Partial<SocketMessage> = {}) => ({
  id: "m1",
  conversationId: "conv-1",
  senderId: "u2",
  content: "hi",
  type: "TEXT",
  createdAt: "2026-10-16T10:00:00.000Z",
  ...overrides,
});

afterEach(() => {
  jest.useRealTimers();
});

describe("createChatSocket — 连接", () => {
  it("把手上的 token 放进握手负载（App 没有 cookie）", async () => {
    const { socket } = setup();
    await tick();

    expect(socket.auth.token).toBe("token-1");
    expect(socket.connectCalls).toBe(1);
  });

  it("连上后进入当前会话的房间，并把状态推成 live", async () => {
    const { socket, states } = setup({ conversationId: "conv-1" });
    await tick();
    socket.open();

    expect(socket.eventsOf("conversation.join")[0]?.payload).toEqual({ conversationId: "conv-1" });
    expect(states.at(-1)).toBe("live");
  });

  it("没打开会话时不 join 任何房间（列表态）", async () => {
    const { socket } = setup({ conversationId: null });
    await tick();
    socket.open();

    expect(socket.eventsOf("conversation.join")).toHaveLength(0);
  });

  it("登录前拿不到 token 就不连（不带着空凭据去握一次手）", async () => {
    const socket = new FakeSocket();
    createChatSocket(
      {
        conversationId: null,
        onMessage: () => undefined,
        onState: () => undefined,
      },
      { createSocket: () => socket, getToken: async () => null },
    );
    await tick();

    expect(socket.connectCalls).toBe(0);
  });
});

describe("createChatSocket — 消息与列表事件", () => {
  it("只转发当前会话的消息，其他会话与畸形负载都丢弃", async () => {
    const { socket, messages } = setup({ conversationId: "conv-1" });
    await tick();
    socket.open();

    socket.fire("message.new", row({ id: "m-other", conversationId: "conv-2" }));
    expect(messages).toHaveLength(0);

    socket.fire("message.new", row({ id: "m-ok" }));
    expect(messages.map((message) => message.id)).toEqual(["m-ok"]);

    socket.fire("message.new", "这不是一个消息对象");
    socket.fire("message.new", { conversationId: "conv-1" });
    expect(messages).toHaveLength(1);
  });

  it("列表事件（conversation.activity）即使没打开会话也转发", async () => {
    const { socket, activities } = setup({ conversationId: null });
    await tick();
    socket.open();

    socket.fire("conversation.activity", {
      conversationId: "conv-9",
      messageId: "m9",
      senderId: "u2",
      type: "TEXT",
      preview: "在吗",
      createdAt: "2026-10-16T10:00:00.000Z",
    });

    expect(activities).toHaveLength(1);
    expect(activities[0]?.conversationId).toBe("conv-9");
  });

  it("图片消息的 preview 是 null（预览文案由客户端决定）", async () => {
    const { socket, activities } = setup({ conversationId: null });
    await tick();
    socket.open();

    socket.fire("conversation.activity", {
      conversationId: "conv-9",
      messageId: "m9",
      senderId: "u2",
      type: "IMAGE",
      preview: null,
      createdAt: "2026-10-16T10:00:00.000Z",
    });

    expect(activities[0]).toMatchObject({ conversationId: "conv-9" });
  });
});

describe("createChatSocket — 重连纪律", () => {
  it("UNAUTHORIZED 只刷新一次：第二次直接停下，不再握手", async () => {
    const { socket, states, refresh } = setup({ conversationId: "conv-1" });
    await tick();
    socket.open();

    socket.fire("error", { code: "UNAUTHORIZED", message: "Invalid or expired access token" });
    // 真实时序：服务端发完 `error` 就把连接踢掉（`client.disconnect(true)`），
    // 所以重连之前 socket 已经是断的 —— 不断的话 `reconnectOnce` 会（正确地）拒绝重连。
    socket.connected = false;
    socket.fire("disconnect", "io server disconnect");
    await tick();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(socket.connectCalls).toBe(2);

    socket.fire("error", { code: "UNAUTHORIZED", message: "Invalid or expired access token" });
    socket.connected = false;
    socket.fire("disconnect", "io server disconnect");
    await tick();

    // 老 web 端在这里变成了「每秒 50 次握手 + 每秒 50 次 refresh」的死循环。
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(socket.connectCalls).toBe(2);
    expect(states.at(-1)).toBe("offline");
  });

  it("会话真正建立后预算恢复：下一次 UNAUTHORIZED 还能再刷一次", async () => {
    const { socket, refresh } = setup({ conversationId: "conv-1" });
    await tick();
    socket.open();

    socket.fire("error", { code: "UNAUTHORIZED" });
    await tick();
    expect(refresh).toHaveBeenCalledTimes(1);

    socket.fire("conversation.joined", { peers: [], typing: [] });
    socket.fire("error", { code: "UNAUTHORIZED" });
    await tick();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("封号 / 停用：不再重连，直接停下", async () => {
    const { socket, states, refresh } = setup({ conversationId: "conv-1" });
    await tick();
    socket.open();

    socket.fire("error", { code: "USER_BANNED", message: "Invalid or expired access token" });
    await tick();

    expect(refresh).not.toHaveBeenCalled();
    expect(states.at(-1)).toBe("offline");
  });

  it("服务端主动断开：有限次重连后退到 offline（不会无限循环）", async () => {
    /*
     * 不用假定时器：RN 的 jest 环境里假定时器会把 Promise 调度一起冻住，
     * `await` 永不返回，测试只能超时（实测如此）。所以把退避基数注入成 0，
     * 用真实定时器把这一支跑完。
     */
    const { socket, states } = setup({ kickDelayMs: 0 });
    await tick();
    socket.open();

    for (let attempt = 0; attempt < 7; attempt += 1) {
      socket.connected = false;
      socket.fire("disconnect", "io server disconnect");
      // 0ms 退避+重连都在下一次宏任务里发生。
      await tick();
    }

    // 初次连接 + 最多 5 次踢回重连；再断开就是 offline。
    expect(socket.connectCalls).toBe(1 + 5);
    expect(states.at(-1)).toBe("offline");
  });

  it("网络抖动（transport close）交给 socket.io 自己重试，我们只改状态", async () => {
    const { socket, states } = setup();
    await tick();
    socket.open();

    socket.connected = false;
    socket.fire("disconnect", "transport close");

    expect(states.at(-1)).toBe("reconnecting");
    expect(socket.connectCalls).toBe(1);
  });

  it("重连预算耗尽（reconnect_failed）→ offline", async () => {
    const { socket, states } = setup();
    await tick();
    socket.open();

    socket.fire("reconnect_failed", undefined);

    expect(states.at(-1)).toBe("offline");
  });
});

describe("createChatSocket — 换会话与关闭", () => {
  it("setConversation 只换房间，不重连", async () => {
    const { socket, handle } = setup({ conversationId: "conv-1" });
    await tick();
    socket.open();

    handle.setConversation("conv-2");

    expect(socket.eventsOf("conversation.leave")[0]?.payload).toEqual({ conversationId: "conv-1" });
    expect(socket.eventsOf("conversation.join").at(-1)?.payload).toEqual({ conversationId: "conv-2" });
    expect(socket.connectCalls).toBe(1);
  });

  it("close：离开房间、断开、之后不再上报状态", async () => {
    const { socket, states, handle } = setup({ conversationId: "conv-1" });
    await tick();
    socket.open();

    handle.close();

    expect(socket.eventsOf("conversation.leave")).toHaveLength(1);
    expect(socket.disconnectCalls).toBe(1);

    const seen = states.length;
    socket.fire("connect");
    expect(states.length).toBe(seen);
  });
});

describe("appendMessageOnce", () => {
  it("同一条消息不重复追加（自己 POST 的返回与 message.new 回声）", () => {
    const first = appendMessageOnce([], { id: "m1" });
    expect(first.map((row) => row.id)).toEqual(["m1"]);

    const again = appendMessageOnce(first, { id: "m1" });
    expect(again).toBe(first);

    const third = appendMessageOnce(again, { id: "m2" });
    expect(third.map((row) => row.id)).toEqual(["m1", "m2"]);
  });
});
