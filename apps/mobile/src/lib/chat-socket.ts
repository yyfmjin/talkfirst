import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { tryRefresh } from "./api";
import { socketBaseUrl } from "./config";
import { getAccessToken } from "./storage";

/**
 * 聊天实时连接（App 端）。
 *
 * ## 为什么现在才做
 *
 * 之前这页是「进入会话拉一页 + 手动下拉刷新 + 发送后重拉」。那时候的理由是
 * 「socket 客户端等于引入新的原生依赖与生命周期管理，而我没有真机可验证」。
 * 两件事后来都变了：`socket.io-client` 是纯 JS（能走热更新，不必重新出包），
 * 而且我已经有模拟器可以真跑一遍。所以补上。
 *
 * ## 认证与 web 不同
 *
 * web 靠 HttpOnly cookie（`withCredentials`）；App 没有 cookie，所以把 access token
 * 放进握手负载 `auth.token` —— 服务端 `ChatAuthService.extractToken` 的第一优先项
 * 就是它（`chat-auth.service.ts`）。token 是每次都现读的：**重连要用最新的那个**，
 * 否则刷新过 token 的会话会一直用过期凭据撞 `UNAUTHORIZED`。
 *
 * ## 两条事件，各有用途
 *
 * - `message.new`：只发给**会话房间**。正在看的会话靠它把消息追加进列表。
 * - `conversation.activity`：服务端额外发给**收件人自己的房间**的一条轻量事件，
 *   带预览/时间/谁发的。会话列表靠它更新 —— 列表不可能把每条会话都 join 一遍。
 *
 * ## 重连不是这里手写的（这条是踩过坑的）
 *
 * 重试交给 socket.io 自己的 Manager：它已经做了指数退避 + 抖动，并且能正确地在
 * 各次尝试之间收尾自己的内部状态。web 端曾经手写 `connect()` 循环，把 Manager
 * 卡在 `opening`，配合「每次 error 都刷新 token」变成每秒几十次握手 + 刷新
 * （实测 12 秒约 650 次）。所以这里的规则是：
 *
 *  - `connect()` 只在自己确实没连上时调用；
 *  - 每个**已建立的**会话（`conversation.joined` 才算）最多刷新一次 token；
 *  - 服务端主动踢（`io server disconnect`）才由我们自己重连，且有次数上限。
 */

export type ChatConnectionState = "connecting" | "live" | "reconnecting" | "offline";

export type SocketMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  type: string;
  createdAt: string;
  clientMessageId?: string | null;
};

/** 会话列表用的轻量事件（不含正文全文、不含安全扫描那类内部字段）。 */
export type ConversationActivity = {
  conversationId: string;
  messageId: string;
  senderId: string;
  type: string;
  /** 文字消息的摘要；图片为 `null`（由客户端显示自己的「图片」文案）。 */
  preview: string | null;
  createdAt: string;
};

export type ChatSocketHandlers = {
  /** 当前正在看的会话；`null` 表示只维护列表（不 join 任何房间）。 */
  conversationId: string | null;
  onMessage: (message: SocketMessage) => void;
  onActivity?: (activity: ConversationActivity) => void;
  onTyping?: (payload: { conversationId: string; userId: string; typing: boolean }) => void;
  onState: (state: ChatConnectionState) => void;
  onError?: (message: string) => void;
};

/**
 * 我们真正用到的 socket.io 能力。
 *
 * 收窄成这个样子有两个好处：测试可以用一个三十行的替身驱动全部重连分支（见
 * `chat-socket.test.ts`），而 socket.io 的类型演进不会漏到这个文件之外。
 */
export type ChatSocketLike = {
  auth: Record<string, unknown>;
  connected: boolean;
  on(event: string, handler: (payload: unknown) => void): void;
  emit(event: string, payload?: unknown): void;
  connect(): void;
  disconnect(): void;
  removeAllListeners(): void;
};

export type ChatSocketDeps = {
  createSocket?: () => ChatSocketLike;
  getToken?: () => Promise<string | null>;
  refresh?: () => Promise<boolean>;
  /**
   * 服务端踢回时的退避基数（毫秒）。
   *
   * 存在的理由只有一个：这一支（有限次重连后退到 offline）在测试里必须能在
   * 10 毫秒内跑完。RN 的 jest 环境里**假定时器会冻住 Promise 调度**，`await`
   * 永远不返回，所以没法用 `jest.advanceTimersByTime` 把它快进过去。
   */
  kickDelayMs?: number;
};

/** 重连预算。与 web 端同值，见文件头「重连不是这里手写的」。 */
const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 800;
const MAX_DELAY_MS = 8000;
/** 服务端主动断开时 Manager 不会重连，这一档退避由我们自己给。 */
const SERVER_KICK_DELAY_MS = 1000;
/** 停止输入多久后自动补一条 `typing: false`（否则对方看到「正在输入」永远不停）。 */
const TYPING_CLEAR_MS = 4000;

function defaultSocketFactory(): ChatSocketLike {
  /*
   * 这一处 cast 是本文件唯一的类型断言，且是**收窄**而不是绕过：
   * socket.io 的 `Socket<Listeners, Emits>` 泛型在这里没有收益（我们的
   * `ChatSocketLike` 反而更严格 —— 事件名是有约束的常量，负载要过校验）。
   */
  return io(`${socketBaseUrl()}/chat`, {
    // App 没有 cookie：凭据走握手负载（见文件头）。
    transports: ["websocket", "polling"],
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: MAX_ATTEMPTS,
    reconnectionDelay: BASE_DELAY_MS,
    reconnectionDelayMax: MAX_DELAY_MS,
    randomizationFactor: 0.5,
  }) as unknown as ChatSocketLike;
}

function readRecord(payload: unknown): Record<string, unknown> | null {
  return typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : null;
}

function readString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

/**
 * 服务端来的负载仍然要过一遍形状校验：这是**我们自己**的协议，但协议变更
 * （或某个字段被改名）在客户端表现为「白屏 / 崩溃」是最糟的失败方式，
 * 而校验的代价只有几行。
 */
function asMessage(payload: unknown): SocketMessage | null {
  const row = readRecord(payload);
  if (!row) return null;
  const id = readString(row, "id");
  const conversationId = readString(row, "conversationId");
  if (!id || !conversationId) return null;
  return {
    id,
    conversationId,
    senderId: readString(row, "senderId") ?? "",
    content: readString(row, "content") ?? "",
    type: readString(row, "type") ?? "TEXT",
    createdAt: readString(row, "createdAt") ?? new Date().toISOString(),
    clientMessageId: readString(row, "clientMessageId"),
  };
}

function asActivity(payload: unknown): ConversationActivity | null {
  const row = readRecord(payload);
  if (!row) return null;
  const conversationId = readString(row, "conversationId");
  if (!conversationId) return null;
  return {
    conversationId,
    messageId: readString(row, "messageId") ?? "",
    senderId: readString(row, "senderId") ?? "",
    type: readString(row, "type") ?? "TEXT",
    preview: readString(row, "preview"),
    createdAt: readString(row, "createdAt") ?? new Date().toISOString(),
  };
}

export type ChatSocketHandle = {
  /**
   * 切换当前正在看的会话。只发 join/leave，**不重连** —— 列表和会话共用一条
   * 连接，正是这点让「在会话里时列表也在更新」成立。
   */
  setConversation(conversationId: string | null): void;
  /** 「正在输入」。`true` 之后 4 秒自动补 false（见 `TYPING_CLEAR_MS`）。 */
  setTyping(typing: boolean): void;
  close(): void;
};

export function createChatSocket(
  handlers: ChatSocketHandlers,
  deps: ChatSocketDeps = {},
): ChatSocketHandle {
  const createSocket = deps.createSocket ?? defaultSocketFactory;
  const getToken = deps.getToken ?? getAccessToken;
  const refresh = deps.refresh ?? tryRefresh;

  const socket = createSocket();
  let stopped = false;
  let wasLive = false;
  /** 每个已建立的会话只允许一次 token 刷新（见文件头）。 */
  let refreshUsed = false;
  /** 服务端踢了我们几次；`conversation.joined` 会把它清零。 */
  let serverKicks = 0;
  /** `error` 处理器正在接管这次重连时置位，避免 kick 的 `disconnect` 再来一次。 */
  let authFlow = false;
  let joined: string | null = handlers.conversationId;
  let typingTimer: ReturnType<typeof setTimeout> | null = null;

  function stop() {
    stopped = true;
    authFlow = false;
    handlers.onState("offline");
  }

  async function open() {
    if (stopped || socket.connected) return;
    const token = await getToken();
    if (stopped) return;
    if (!token) {
      // 没登录就不连：这不是错误，界面上不该出现「连接失败」。
      handlers.onState("offline");
      return;
    }
    socket.auth = { token };
    socket.connect();
  }

  /** 我们唯一会自己发起的那次重连（Manager 不管服务端主动断开）。 */
  function reconnectOnce() {
    if (stopped || socket.connected) return;
    void open();
  }

  socket.on("connect", () => {
    if (stopped) return;
    wasLive = true;
    authFlow = false;
    handlers.onState("live");
    if (joined) socket.emit("conversation.join", { conversationId: joined });
  });

  socket.on("disconnect", (payload) => {
    if (stopped) return;
    const reason = typeof payload === "string" ? payload : "";
    if (reason === "io client disconnect") return;
    if (authFlow) return;
    if (reason === "io server disconnect") {
      if (serverKicks >= MAX_ATTEMPTS) {
        stop();
        return;
      }
      serverKicks += 1;
      handlers.onState("reconnecting");
      setTimeout(reconnectOnce, (deps.kickDelayMs ?? SERVER_KICK_DELAY_MS) * serverKicks);
      return;
    }
    handlers.onState("reconnecting");
  });

  socket.on("connect_error", () => {
    if (stopped) return;
    handlers.onState(wasLive ? "reconnecting" : "connecting");
  });

  socket.on("reconnect_failed", () => {
    if (stopped) return;
    stop();
  });

  socket.on("error", (payload) => {
    if (stopped) return;
    const row = readRecord(payload);
    const code = row ? readString(row, "code") : null;
    const message = row ? readString(row, "message") : null;
    if (message) handlers.onError?.(message);
    if (code === "USER_BANNED" || code === "USER_DISABLED") {
      stop();
      return;
    }
    if (code !== "UNAUTHORIZED") return;
    if (refreshUsed) {
      // 这个会话唯一的一次刷新已经用掉了：再重试只会变成死循环。
      stop();
      return;
    }
    refreshUsed = true;
    authFlow = true;
    void refresh().then((ok) => {
      if (stopped) return;
      if (!ok) {
        stop();
        return;
      }
      reconnectOnce();
    });
  });

  socket.on("conversation.joined", () => {
    if (stopped) return;
    // 到这里才算「这个会话真的建立了」：服务端接受了 join，而不只是传输层通了。
    // 预算也在这里才恢复 —— `connect` 成功但 join 被拒时不该把刷新次数还回去。
    refreshUsed = false;
    serverKicks = 0;
  });

  socket.on("message.new", (payload) => {
    if (stopped) return;
    const message = asMessage(payload);
    if (!message) return;
    // 只转发当前会话：离开房间后仍可能收到在途事件。
    if (joined && message.conversationId !== joined) return;
    handlers.onMessage(message);
  });

  socket.on("conversation.activity", (payload) => {
    if (stopped) return;
    const activity = asActivity(payload);
    if (!activity) return;
    handlers.onActivity?.(activity);
  });

  socket.on("typing", (payload) => {
    if (stopped) return;
    const row = readRecord(payload);
    if (!row) return;
    const conversationId = readString(row, "conversationId");
    const userId = readString(row, "userId");
    if (!conversationId || !userId) return;
    if (joined && conversationId !== joined) return;
    handlers.onTyping?.({ conversationId, userId, typing: row.typing === true });
  });

  void open();

  return {
    setConversation(conversationId) {
      if (stopped) return;
      const next = conversationId ?? null;
      if (joined === next) return;
      if (joined && socket.connected) socket.emit("conversation.leave", { conversationId: joined });
      joined = next;
      if (next && socket.connected) socket.emit("conversation.join", { conversationId: next });
    },
    setTyping(typing) {
      if (stopped) return;
      if (joined) socket.emit("typing", { conversationId: joined, typing });
      if (typingTimer) clearTimeout(typingTimer);
      if (typing) {
        typingTimer = setTimeout(() => {
          if (stopped || !joined) return;
          socket.emit("typing", { conversationId: joined, typing: false });
        }, TYPING_CLEAR_MS);
      }
    },
    close() {
      stopped = true;
      if (typingTimer) clearTimeout(typingTimer);
      if (joined && socket.connected) {
        socket.emit("conversation.leave", { conversationId: joined });
      }
      // 先摘监听器再断开：清理不能重新走进重连分支，重挂载也不该继承监听器。
      socket.removeAllListeners();
      socket.disconnect();
    },
  };
}

export type UseChatSocketOptions = {
  conversationId: string | null;
  /** 关掉时不连（例如用户还没登录）。 */
  enabled?: boolean;
  onMessage: (message: SocketMessage) => void;
  onActivity?: (activity: ConversationActivity) => void;
  onTyping?: (payload: { conversationId: string; userId: string; typing: boolean }) => void;
};

/**
 * 屏幕级的实时连接。**一条连接服务整个屏幕**：会话列表与会话都挂在它上面
 * （切换正在看的会话走 `setConversation`，不重连）。
 *
 * 回调进 ref：调用方每次渲染都会新建闭包，若把它们放进 effect 依赖，
 * 每次渲染都会重连一次。
 */
export function useChatSocket(options: UseChatSocketOptions): {
  state: ChatConnectionState;
  error: string;
  setTyping: (typing: boolean) => void;
} {
  const [state, setState] = useState<ChatConnectionState>("connecting");
  const [error, setError] = useState("");
  const callbacks = useRef(options);
  callbacks.current = options;
  const handleRef = useRef<ChatSocketHandle | null>(null);

  const enabled = options.enabled ?? true;

  useEffect(() => {
    if (!enabled) return;
    const handle = createChatSocket({
      conversationId: callbacks.current.conversationId,
      onMessage: (message) => callbacks.current.onMessage(message),
      onActivity: (activity) => callbacks.current.onActivity?.(activity),
      onTyping: (payload) => callbacks.current.onTyping?.(payload),
      onState: setState,
      onError: setError,
    });
    handleRef.current = handle;
    return () => {
      handleRef.current = null;
      handle.close();
    };
  }, [enabled]);

  useEffect(() => {
    handleRef.current?.setConversation(options.conversationId);
  }, [options.conversationId]);

  return {
    state,
    error,
    setTyping: (typing) => handleRef.current?.setTyping(typing),
  };
}

/**
 * 去重追加：同一条消息会从两条路到达 —— 自己发送时 REST 返回的那一条，
 * 以及服务器广播给整个会话房间（包括发送者自己）的 `message.new`。
 *
 * 只按 `id` 判重：id 是服务端生成的，就是同一性的定义；客户端自己造的
 * 临时 id（如 web 的 `local-…`）与本端无关，本端不做乐观插入，一律以服务端为准。
 */
export function appendMessageOnce<T extends { id: string }>(current: T[], incoming: T): T[] {
  return current.some((item) => item.id === incoming.id) ? current : [...current, incoming];
}

/**
 * 把服务端最新一页并进当前列表，按 `id` 去重后按时间升序。
 *
 * 用在断线重连之后：断线期间的消息不会再补发广播，只能重新拉一次最新页；
 * 但直接替换整页会把用户正在看的旧消息抽走，所以是合并而不是替换。
 *
 * 同一毫秒的两条按 `id` 排（`id` 是 uuid，顺序本身没意义，但至少稳定）。
 */
export function mergeMessages<T extends { id: string; createdAt: string }>(
  current: T[],
  incoming: T[],
): T[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((left, right) =>
    left.createdAt === right.createdAt
      ? left.id.localeCompare(right.id)
      : left.createdAt.localeCompare(right.createdAt),
  );
}
