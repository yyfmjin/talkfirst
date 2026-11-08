import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
/*
 * `expo-image-manipulator` **故意不在这里 import**（见 `uploadImageMessage`）：
 * 它是 2026-11-08 才加的原生模块，而 OTA 会把这份 JS 推给更早安装的 0.1.21 包 ——
 * 那些包的 APK 里没有这个模块，顶层 import 会让它们一启动就崩。
 */
/*
 * 语音读取用 legacy 入口：SDK 54 的新 API 把 `readAsStringAsync` 换成了 `File` 类，
 * 而动态发布那条链路（ComposeScreen）已经在用 legacy —— 两处保持一致，
 * 免得同一个功能在 `expo-file-system` 的两套 API 之间来回。
 */
import * as FileSystem from "expo-file-system/legacy";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  useAudioRecorder,
} from "expo-audio";
import { useVideoPlayer, VideoView } from "expo-video";
import { apiFetch, ApiRequestError, apiUploadMultipart } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { appendMessageOnce, mergeMessages, useChatSocket } from "../lib/chat-socket";
import { useBackHandler } from "../lib/back-stack";
import { Avatar } from "../components/Avatar";
import { AttachmentSheet } from "../components/AttachmentSheet";
import { MediaPreviewBar } from "../components/MediaPreviewBar";
import { Icon } from "../components/Icon";
import { VoiceNote, formatVoiceDuration } from "../components/VoiceNote";
import { KeyboardAware } from "../components/KeyboardAware";
import { AiScreen } from "./AiScreen";
import { UnreadBadge } from "../components/UnreadBadge";
import { ExchangeScreen } from "./ExchangeScreen";
import { NotificationsScreen } from "./NotificationsScreen";
import { useI18n, type TranslateFn } from "../lib/i18n-context";
import { playGreetingSound, playMessageSound } from "../lib/notification-sound";
import { navigateTo } from "../lib/nav-intent";
import type { MsgKey } from "../lib/messages";
import { colors, themed } from "../theme";
import type { ChatMessage, ConversationItem, IncomingRequest, MessagePage, MessageQuote } from "../lib/types";

import { radii, sizes } from "../design/tokens";

/**
 * 聊天附件（2026-11-08）。
 *
 * 图片在客户端压：长边 1600、JPEG 0.72 —— 手机原图动辄 4–8MB，而聊天里的图片
 * 显示宽度不超过 220，不压只是白占服务器磁盘和对方的流量。
 *
 * 视频不在客户端压：手机上可靠的转码库要么体积翻倍、要么耗时不可控；客户端只做
 * 两道闸（时长 ≤ 60s、文件 ≤ 90MB），真正的压缩交给服务端 ffmpeg
 * （`POST /uploads/message-video`，与动态视频同一套流程）。
 */
const IMAGE_MAX_EDGE = 1600;
const IMAGE_QUALITY = 0.72;
const MAX_VIDEO_UPLOAD_BYTES = 90 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 60;

/**
 * 语音消息（2026-11-08）。
 *
 * 60 秒封顶：微信/WhatsApp 的单条语音都是这个量级 —— 再长就该用视频或分段发。
 * 4MB 是服务端 `MAX_AUDIO_BYTES`；AAC 60 秒约 400KB，这道闸只有在采样率异常时才碰得到。
 */
const MAX_VOICE_SECONDS = 60;
const MAX_VOICE_BYTES = 4 * 1024 * 1024;
/**
 * 消息（2026-10-07；实时 2026-10-16）—— 会话列表 + 会话内对话。
 *
 * ## 实时
 *
 * 一个 socket 连接同时服务两个位置（实现在 `lib/chat-socket.ts`）：
 *
 *   - **打开的会话**：`message.new` 直接把新消息接进 `messages`（按 id 去重 ——
 *     自己发的那条同时从 REST 返回、又是广播的回声）；
 *   - **列表**：`conversation.activity` 只发给收件人自己的房间（列表页不可能把所有
 *     会话都 join 一遍），用它更新预览/未读/排序。
 *
 * 发送仍走 REST（`POST /conversations/:id/messages`）：它能明确报错、区分
 * AI 会话，而 socket 只用来**接收**。
 *
 * 断线期间的消息不会补发广播，所以重新连上时补拉一次最新页（合并，不替换）。
 *
 * ## 打开会话时顺手清掉它的消息通知
 *
 * `POST /conversations/:id/read` 不只是写 `lastReadAt`：服务端还会把这条会话的
 * **未读消息通知**一并标为已读（通知合并的另一半）。所以这里两件事一次做完，
 * 不需要客户端再调通知的接口。
 */
export function MessagesScreen() {
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  /** 收到的连接申请（对齐 web `/messages` 顶部那一块）。 */
  const [incoming, setIncoming] = useState<IncomingRequest[]>([]);
  const [actingId, setActingId] = useState<string | null>(null);
  /** 已翻译的消息：messageId → 译文。 */
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  /** 会话里的「交换联系方式」全屏子页（对齐 web 的 `/messages/[id]/connect`）。 */
  const [exchange, setExchange] = useState(false);
  /** AI 朋友全屏子页（对齐 web 的 `/ai`，入口在列表顶部）。 */
  const [ai, setAi] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  /** 对方读到哪个时刻（已读回执）；只在 1:1 人机会话里有意义。 */
  const [peerReadAt, setPeerReadAt] = useState<string | null>(null);
  /** 正在回复的那条消息（引用条）；发出去后清空。 */
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  /** 附件上传中：按钮转圈，避免连点发出两条。 */
  const [attaching, setAttaching] = useState(false);
  /** 「+」打开的底部面板。 */
  const [attachOpen, setAttachOpen] = useState(false);
  /**
   * 选好、还没发出去的媒体。
   *
   * 保留原始的 `ImagePickerAsset`：压缩/转码要用它的宽高与 mime，
   * 预览条只需要从里面取 uri / fileSize / duration。
   */
  const [pending, setPending] = useState<{ kind: "image" | "video"; asset: ImagePicker.ImagePickerAsset } | null>(
    null,
  );
  /** 正在全屏播放的视频 URL。 */
  const [playingVideo, setPlayingVideo] = useState<string | null>(null);

  /**
   * 语音录制（2026-11-08）。
   *
   * 交互取微信/Telegram 的「点一下开始、再点发送」而不是长按：长按在 RN 里要靠
   * onPressIn/onPressOut 配滑动取消，手势一乱就变成误发或录不停；显式两个按钮
   * （取消 / 发送）在小屏幕上也更好点。
   */
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [recordSec, setRecordSec] = useState(0);
  const [voiceSending, setVoiceSending] = useState(false);
  const recordStartedAt = useRef(0);
  const [error, setError] = useState("");
  /**
   * 会话 / 通知两个分段。
   *
   * 2026-10-08 运营方反馈「通知界面跟消息界面有点重合，合并到一起」—— 分开两个 tab
   * 对使用的人没有意义（都是「谁来找过我」），所以合并成一页里的两个分段，
   * 底部 tab 也就从 5 个减到 4 个。
   */
  const [segment, setSegment] = useState<"conversations" | "notifications">("conversations");
  /** 对方正在输入（服务端 `typing` 事件；只关心当前会话与别人）。 */
  const [peerTyping, setPeerTyping] = useState(false);

  /**
   * 已经见过的打招呼请求 id。
   *
   * `null` = 还没加载过。首次加载**不响**：那不是「新请求」，而是整个列表一次性到位。
   * 之后每次刷新比对差集，只有新增的那几条才触发三音提示。
   */
  const knownRequestIds = useRef<Set<string> | null>(null);

  /**
   * 新请求 → 三音提示音，并把「见过的 id」推进到当前快照。
   *
   * 抽成函数是因为有两个入口：列表刷新（拉会话时顺带拉的）和轮询（只拉请求）。
   * 两边都得判「新」，否则轮询会把历史申请再响一遍。
   */
  const applyIncomingRequests = useCallback((requests: IncomingRequest[]) => {
    setIncoming(requests);
    const seen = knownRequestIds.current;
    if (seen && requests.some((item) => !seen.has(item.id))) playGreetingSound();
    knownRequestIds.current = new Set(requests.map((item) => item.id));
  }, []);

  const loadConversations = useCallback(async () => {
    setError("");
    try {
      /*
       * 申请与会话一起拉：两个都在同一屏，分两次串行只会多一次白屏。
       * 申请接口单独失败时降级为空列表 —— 没弹申请不应该连带把会话也变成错误页。
       */
      const [chats, requests] = await Promise.all([
        apiFetch<ConversationItem[]>("/conversations"),
        apiFetch<IncomingRequest[]>("/connections/requests/incoming").catch(() => []),
      ]);
      setConversations(chats);
      applyIncomingRequests(requests);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("messages.errorList"));
    } finally {
      setLoading(false);
    }
  }, [t, applyIncomingRequests]);

  /**
   * 打招呼请求没有 socket 事件（服务端只给 REST），所以靠轮询补上「实时」。
   *
   * 45 秒：打招呼不是聊天，晚半分钟听到并不影响判断；再密只是白烧请求。
   * 只在 App 处于前台时拉，失败静默 —— 这是背景刷新，不该在页面上留错误。
   */
  useEffect(() => {
    const timer = setInterval(() => {
      if (AppState.currentState !== "active") return;
      void apiFetch<IncomingRequest[]>("/connections/requests/incoming")
        .then(applyIncomingRequests)
        .catch(() => undefined);
    }, 45_000);
    return () => clearInterval(timer);
  }, [applyIncomingRequests]);

  /** 接受 / 拒绝一条申请。服务端动作完成后重新拉一遍：会话可能刚建出来。 */
  async function respondRequest(id: string, action: "accept" | "reject") {
    setActingId(id);
    try {
      await apiFetch(`/connections/requests/${id}/respond`, {
        method: "POST",
        body: { action },
      });
      await loadConversations();
    } catch {
      setError(t("messages.requestActionFailed"));
    } finally {
      setActingId(null);
    }
  }

  /** 翻译一条消息（服务端 LibreTranslate；与网页同一个接口）。 */
  async function translateMessage(messageId: string) {
    if (translatingId) return;
    setTranslatingId(messageId);
    try {
      const result = await apiFetch<{ text: string }>(`/messages/${messageId}/translate`, {
        method: "POST",
        body: { targetLang: locale },
      });
      setTranslations((current) => ({ ...current, [messageId]: result.text }));
    } catch {
      setTranslations((current) => ({ ...current, [messageId]: "" }));
    } finally {
      setTranslatingId(null);
    }
  }

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  /** 重新拉一次正在看的那个会话的最新页（断线重连后用）。 */
  const refreshOpenConversation = useCallback(async (id: string) => {
    try {
      const data = await apiFetch<MessagePage>(`/conversations/${id}/messages?limit=30`);
      setMessages((previous) => mergeMessages(previous, data.items));
    } catch {
      // 补拉失败不惊动用户：下次打开会话或重连会再试。
    }
  }, []);

  const { state: liveState, setTyping } = useChatSocket({
    conversationId: openId,
    onMessage: (message) => {
      setMessages((previous) => {
        /*
         * 自己发的消息会从两条路到达：REST 返回的那条（由 send 替换本地条目）与
         * 服务端广播的这条。广播先到时，本地乐观条目还挂着 —— 先按「同文同型」把它
         * 拿掉，否则屏幕上会同时出现一条灰的本地条目和一条真实消息。
         * 只对「自己发的」做这个清理：别人的消息不可能有本地副本。
         */
        const withoutLocal =
          message.senderId === user?.id
            ? previous.filter(
                (item) =>
                  !(
                    item.local &&
                    item.senderId === message.senderId &&
                    item.content === message.content &&
                    item.type === message.type
                  ),
              )
            : previous;
        return appendMessageOnce(withoutLocal, message);
      });
      // 正看着这个会话：列表上的未读不该留着。
      setConversations((previous) =>
        previous.map((item) =>
          item.id === message.conversationId ? { ...item, unreadCount: 0 } : item,
        ),
      );
      setPeerTyping(false);
      /*
       * 正在看这个会话：把服务端的已读位置也推进到现在。
       * 只改本地 unreadCount 不够 —— 对方会一直看到「未读」，而你的确已经看到了。
       */
      void apiFetch(`/conversations/${message.conversationId}/read`, { method: "POST" }).catch(
        () => undefined,
      );
    },
    onPeerRead: (payload) => {
      /* 只有「对方读」才改变这一格；自己的其他设备回显不该把消息标成已读。 */
      if (payload.userId === user?.id) return;
      if (payload.conversationId !== openIdRef.current) return;
      setPeerReadAt(payload.lastReadAt);
    },
    onActivity: (activity) => {
      /*
       * 新消息提示音：别人发来的才响，而且正在看这个会话时不响 ——
       * 消息已经在眼前出现，再响一声只是多余。
       */
      if (activity.senderId !== user?.id && activity.conversationId !== openIdRef.current) {
        playMessageSound();
      }
      setConversations((previous) => {
        const index = previous.findIndex((item) => item.id === activity.conversationId);
        // 列表里还没有这个会话（对方第一次发来消息）：重拉列表拿头像/昵称。
        if (index < 0) {
          void loadConversations();
          return previous;
        }
        const target = previous[index];
        const updated: ConversationItem = {
          ...target,
          // 打开着这个会话就不涨未读 —— 用户已经在看了。
          unreadCount: openId === activity.conversationId ? 0 : (target.unreadCount ?? 0) + 1,
          updatedAt: activity.createdAt,
          lastMessage: {
            content: activity.preview ?? "",
            senderId: activity.senderId,
            createdAt: activity.createdAt,
            type: activity.type,
          },
        };
        // 有新消息的会话浮到最上面，与刷新后的服务端顺序一致。
        return [updated, ...previous.filter((_, position) => position !== index)];
      });
    },
    onTyping: (payload) => {
      if (payload.userId !== user?.id) setPeerTyping(payload.typing);
    },
  });

  /*
   * 从「非 live」回到 live 时补一次数据：断线期间的消息不会有广播，
   * 只能重新拉一次（列表 + 正在看的会话）。
   *
   * 初值是 `true`：首次连接不需要补拉 —— 挂载时本来就会拉列表，
   * 而会话内容是打开时才拉的。
   */
  const wasLive = useRef(true);
  /** 会话列表的最新快照（给回调读，不进依赖数组）。 */
  const conversationsRef = useRef<ConversationItem[]>([]);
  conversationsRef.current = conversations;
  /** 当前打开的会话 id（异步逻辑里判断「用户还在不在这个会话」）。 */
  const openIdRef = useRef<string | null>(null);
  openIdRef.current = openId;
  /** 消息列表本体：打开会话、来新消息时用它滚到最新一条。 */
  const threadListRef = useRef<FlatList<ChatMessage>>(null);
  /**
   * 是否「贴着底部」。
   *
   * 用户往上翻旧消息时不拽他；打开会话、或本来就停在底部时才跟。
   * 用 ref 而不是 state：滚动事件每帧都来，state 会把整屏重渲染几十次。
   */
  const stickToBottom = useRef(true);
  useEffect(() => {
    if (liveState !== "live") {
      wasLive.current = false;
      return;
    }
    if (wasLive.current) return;
    wasLive.current = true;
    void loadConversations();
    if (openId) void refreshOpenConversation(openId);
  }, [liveState, openId, loadConversations, refreshOpenConversation]);

  /*
   * 系统返回键：先关更靠前的子页，再关会话本身（注册晚的优先级高）。
   * AI 朋友屏自己管返回（设定页 → 聊天页 → 关掉），所以这里不管它。
   */
  useBackHandler(openId !== null, () => {
    setOpenId(null);
    setExchange(false);
    void loadConversations();
  });
  useBackHandler(openId !== null && exchange, () => setExchange(false));

  /**
   * 打开 AI 聊天（2026-10-29）。
   *
   * 顺手把这一行的未读清零：`/ai-companion/messages/read` 只改服务端的
   * `lastReadAt`，本地这份 `conversations` 不会自己变 —— 于是「读完退出来，
   * 红点还挂着」。退出时再补拉一次（见 `<AiScreen onBack>`），两边就都干净了。
   */
  const openAi = useCallback(() => {
    setConversations((previous) =>
      previous.map((item) => (item.type === "AI" ? { ...item, unreadCount: 0 } : item)),
    );
    setAi(true);
  }, []);

  const openConversation = useCallback(async (id: string) => {
    /*
     * AI 会话不在这一层打开：它的消息只能走 `/ai-companion`，普通会话接口对它一律
     * 404 CONVERSATION_NOT_FOUND。用 ref 读列表而不是把 conversations 放进依赖 ——
     * 后者会让这个回调每次拉完列表就变一个，挂着它的 effect 跟着重跑。
     */
    if (conversationsRef.current.find((item) => item.id === id)?.type === "AI") {
      openAi();
      return;
    }
    setOpenId(id);
    setExchange(false);
    setPeerTyping(false);
    setMessages([]);
    setCursor(null);
    setPeerReadAt(null);
    setReplyTarget(null);
    setError("");
    try {
      const data = await apiFetch<MessagePage>(`/conversations/${id}/messages?limit=30`);
      setMessages(data.items);
      setCursor(data.nextCursor);
      setPeerReadAt(data.peerLastReadAt ?? null);
      /*
       * 打开会话就停在最新一条（以前停在最上面，看到的是很早以前的对话）。
       * 等这一帧渲染完再滚：此刻 `contentSize` 才是新会话的高度。
       */
      stickToBottom.current = true;
      requestAnimationFrame(() => threadListRef.current?.scrollToEnd({ animated: false }));
      // 已读：写 lastReadAt，并清掉这条会话的未读消息通知。
      await apiFetch(`/conversations/${id}/read`, { method: "POST" });
      setConversations((previous) =>
        previous.map((item) => (item.id === id ? { ...item, unreadCount: 0 } : item)),
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("messages.errorThread"));
    }
  }, [openAi, t]);

  /** 更早的一页：服务端最旧在前，`nextCursor` 指向更早。 */
  async function loadOlder() {
    if (!openId || !cursor) return;
    try {
      const data = await apiFetch<MessagePage>(
        `/conversations/${openId}/messages?limit=30&cursor=${encodeURIComponent(cursor)}`,
      );
      setMessages((previous) => [...data.items, ...previous]);
      setCursor(data.nextCursor);
    } catch {
      // 翻旧消息失败不打扰当前阅读。
    }
  }

  /**
   * AI 会话的回复兑底刷新。
   *
   * 回复是模型生成的，比 HTTP 响应晚一两秒落库；旧版 App 常驻在会话里时只能靠
   * socket 广播拿到它，网络/重连一抖动就变成「必须退出再进才看得到」。
   * 这里发几次刷新，合并结果幂等，多刷几次无害；用户切走了就停。
   */
  async function pollForAiReply(conversationId: string) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500 + attempt * 800));
      if (openIdRef.current !== conversationId) return;
      await refreshOpenConversation(conversationId);
    }
  }

  /**
   * 发文字（乐观发送，2026-11-08）。
   *
   * 先把一条本地消息插进列表，服务端确认后用真实消息替换；失败则标成可点重发。
   * 之前是「等服务端返回才出现」—— 弱网下输入框已清空、消息却半天不出来，
   * 用户会以为没发出去而再打一遍。
   */
  async function send() {
    const content = draft.trim();
    const conversationId = openId;
    if (!conversationId || !content || sending) return;
    const quoted = replyTarget;

    const optimistic: ChatMessage = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      conversationId,
      senderId: user?.id ?? "",
      content,
      type: "TEXT",
      createdAt: new Date().toISOString(),
      local: true,
      replyTo: quoted
        ? {
            id: quoted.id,
            senderId: quoted.senderId,
            type: quoted.type,
            content: quoted.content.slice(0, 120),
          }
        : null,
    };

    setMessages((previous) => [...previous, optimistic]);
    setDraft("");
    setReplyTarget(null);
    setTyping(false);
    setSending(true);
    setError("");
    try {
      const created = await apiFetch<ChatMessage>(`/conversations/${conversationId}/messages`, {
        method: "POST",
        body: {
          content,
          /* 引用目标还没被服务端确认（本地条目）时不能当 replyToId 发。 */
          ...(quoted && !quoted.local ? { replyToId: quoted.id } : {}),
        },
      });
      setMessages((previous) =>
        previous.map((item) => (item.id === optimistic.id ? created : item)),
      );
      void loadConversations();
      if (conversationsRef.current.find((item) => item.id === conversationId)?.type === "AI") {
        void pollForAiReply(conversationId);
      }
    } catch (requestError) {
      setMessages((previous) =>
        previous.map((item) => (item.id === optimistic.id ? { ...item, failed: true } : item)),
      );
      setError(requestError instanceof Error ? requestError.message : t("messages.errorSend"));
    } finally {
      setSending(false);
    }
  }

  /** 点一下失败的消息：原地重发（先把旧条目拿掉，成功再插服务端那条）。 */
  async function resendMessage(failed: ChatMessage) {
    const conversationId = openId;
    if (!conversationId || sending) return;
    setMessages((previous) => previous.filter((item) => item.id !== failed.id));
    setSending(true);
    setError("");
    try {
      const created = await apiFetch<ChatMessage>(`/conversations/${conversationId}/messages`, {
        method: "POST",
        body: {
          content: failed.content,
          ...(failed.replyTo && !failed.replyTo.id.startsWith("local-")
            ? { replyToId: failed.replyTo.id }
            : {}),
        },
      });
      setMessages((previous) => appendMessageOnce(previous, created));
      void loadConversations();
    } catch (requestError) {
      setMessages((previous) => [...previous, { ...failed, failed: true }]);
      setError(requestError instanceof Error ? requestError.message : t("messages.errorSend"));
    } finally {
      setSending(false);
    }
  }

  /** 长按气泡：回复，以及（自己的消息）撤回。 */
  function openMessageActions(item: ChatMessage) {
    if (item.local) return;
    const options: Array<{
      text: string;
      style?: "cancel" | "destructive";
      onPress?: () => void;
    }> = [{ text: t("messages.reply"), onPress: () => setReplyTarget(item) }];
    if (item.senderId === user?.id) {
      options.push({
        text: t("messages.recall"),
        style: "destructive",
        onPress: () => void recallMessage(item),
      });
    }
    options.push({ text: t("common.cancel"), style: "cancel" });
    Alert.alert(t("messages.messageActions"), undefined, options);
  }

  /** 选图/选视频：一条消息只带一个附件，选完立即上传发送。 */
  function pickAttachment() {
    if (!openId || attaching) return;
    setAttachOpen(true);
  }

  /**
   * 选媒体：**只选，不上传**。
   *
   * 选完先进预览条（缩略图 + 体积 + 发送/取消），确认了才真正上传 —— 这样选错一张图
   * 不会先发出去再撤回，也给了「看一眼再决定」的余地。
   */
  async function sendPicked(kind: "image" | "video") {
    setAttachOpen(false);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError(t("messages.mediaPermission"));
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: kind === "image" ? ["images"] : ["videos"],
        allowsMultipleSelection: false,
        quality: 1,
        ...(kind === "video" ? { videoMaxDuration: MAX_VIDEO_SECONDS } : {}),
      });
      if (result.canceled || result.assets.length === 0) return;
      setError("");
      setPending({ kind, asset: result.assets[0] });
    } catch (mediaError) {
      setError(
        mediaError instanceof Error ? mediaError.message : t("messages.mediaUploadFailed"),
      );
    }
  }

  /** 预览条上的「发送」：这一步才真的上传。 */
  async function sendPendingMedia() {
    const conversationId = openId;
    const chosen = pending;
    if (!conversationId || !chosen || attaching) return;
    setAttaching(true);
    setError("");
    try {
      const created =
        chosen.kind === "image"
          ? await uploadImageMessage(conversationId, chosen.asset)
          : await uploadVideoMessage(conversationId, chosen.asset);
      // 与文字消息一致：服务端返回的那一条直接接在末尾，广播回来的由 appendMessageOnce 去重。
      setMessages((previous) => appendMessageOnce(previous, created));
      void loadConversations();
      setPending(null);
    } catch (mediaError) {
      setError(
        mediaError instanceof ApiRequestError && mediaError.code === "IMAGE_TOO_LARGE"
          ? t("messages.imageTooLarge")
          : mediaError instanceof Error
            ? mediaError.message
            : t("messages.mediaUploadFailed"),
      );
    } finally {
      setAttaching(false);
    }
  }

  /** 图片：先压到长边 1600 / JPEG 0.72，再以 data URL 传（服务端另有一道 5MB 闸）。 */
  async function uploadImageMessage(
    conversationId: string,
    asset: ImagePicker.ImagePickerAsset,
  ): Promise<ChatMessage> {
    /*
     * 懒加载见文件头：早期安装的 APK 没有这个原生模块，顶层 import 会直接崩进程。
     * 在这里 require 的好处是「新包正常、老包只是发图失败」，而不是整个 App 打不开。
     */
    let manipulator: typeof import("expo-image-manipulator");
    try {
      manipulator = require("expo-image-manipulator") as typeof import("expo-image-manipulator");
    } catch {
      throw new Error(t("messages.imageToolUnavailable"));
    }

    const width = asset.width ?? IMAGE_MAX_EDGE;
    const actions = width > IMAGE_MAX_EDGE ? [{ resize: { width: IMAGE_MAX_EDGE } }] : [];
    const shrunk = await manipulator.manipulateAsync(asset.uri, actions, {
      compress: IMAGE_QUALITY,
      format: manipulator.SaveFormat.JPEG,
      base64: true,
    });
    if (!shrunk.base64) throw new Error(t("messages.mediaUploadFailed"));

    const uploaded = await apiFetch<{ imageUrl: string }>("/uploads/message-image", {
      method: "POST",
      body: { image: `data:image/jpeg;base64,${shrunk.base64}` },
    });
    return apiFetch<ChatMessage>(`/conversations/${conversationId}/messages/image`, {
      method: "POST",
      body: { imageUrl: uploaded.imageUrl },
    });
  }

  /** 视频：客户端不转码，只卡时长与大小；压缩由服务端 ffmpeg 做。 */
  async function uploadVideoMessage(
    conversationId: string,
    asset: ImagePicker.ImagePickerAsset,
  ): Promise<ChatMessage> {
    if (asset.fileSize && asset.fileSize > MAX_VIDEO_UPLOAD_BYTES) {
      throw new Error(t("messages.videoTooLarge"));
    }
    const form = new FormData();
    form.append("file", {
      uri: asset.uri,
      name: asset.fileName ?? `chat-${Date.now()}.mp4`,
      type: asset.mimeType ?? "video/mp4",
    } as unknown as Blob);

    const uploaded = await apiUploadMultipart<{ url: string }>("/uploads/message-video", form);
    return apiFetch<ChatMessage>(`/conversations/${conversationId}/messages/video`, {
      method: "POST",
      body: { videoUrl: uploaded.url },
    });
  }

  /* ── 语音录制 ─────────────────────────────────────────────── */

  /**
   * 离开页面时把录到一半的麦关掉。
   *
   * 没有这一句，用户录到一半按返回键，麦克风会一直开着直到下次进入再被覆盖 ——
   * 这是隐私问题，不是体验问题。`stop()` 在未开始录音时会抛，故意吞掉。
   */
  useEffect(() => {
    return () => {
      void recorder.stop().catch(() => undefined);
    };
  }, [recorder]);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      setRecordSec((previous) => Math.min(MAX_VOICE_SECONDS, previous + 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [recording]);

  async function startRecording() {
    if (recording || voiceSending || !openId) return;
    setError("");
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setError(t("messages.micDenied"));
      return;
    }
    try {
      await recorder.prepareToRecordAsync();
      recorder.record();
      recordStartedAt.current = Date.now();
      setRecordSec(0);
      setRecording(true);
      // 到点自动发：忘关麦会把整段环境音录进去，而服务端也只收 60 秒。
      setTimeout(() => void stopRecording(true), MAX_VOICE_SECONDS * 1000);
    } catch {
      setError(t("messages.recordFailed"));
    }
  }

  /** `send=false` 即取消：停掉录音并丢掉临时文件，不产生消息。 */
  async function stopRecording(send: boolean) {
    if (!recording) return;
    setRecording(false);
    try {
      await recorder.stop();
    } catch {
      // 停不下来也要往下走：下面按 uri 是否可读决定能不能发
    }
    const uri = recorder.uri;
    const conversationId = openId;
    // 用起止时间算时长：切后台时 interval 会被节流，计数的秒数会偏短。
    const elapsed = recordStartedAt.current
      ? Math.round((Date.now() - recordStartedAt.current) / 1000)
      : recordSec;
    if (!send || !uri || !conversationId) return;
    if (elapsed < 1) {
      setError(t("messages.voiceTooShort"));
      return;
    }
    setVoiceSending(true);
    try {
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      if (base64.length * 0.75 > MAX_VOICE_BYTES) throw new Error("AUDIO_TOO_LARGE");
      const uploaded = await apiFetch<{ url: string }>("/uploads/message-audio", {
        method: "POST",
        body: { audio: `data:audio/m4a;base64,${base64}` },
      });
      const created = await apiFetch<ChatMessage>(
        `/conversations/${conversationId}/messages/audio`,
        { method: "POST", body: { audioUrl: uploaded.url } },
      );
      setMessages((previous) => appendMessageOnce(previous, created));
      void loadConversations();
    } catch (voiceError) {
      setError(
        voiceError instanceof Error && voiceError.message === "AUDIO_TOO_LARGE"
          ? t("messages.voiceTooLong")
          : t("messages.voiceUploadFailed"),
      );
    } finally {
      setVoiceSending(false);
    }
  }

  /**
   * 撤回自己的消息：服务端限 24 小时内且只能删自己发的，这里只负责弹确认与本地移除。
   *
   * 不做乐观移除：删失败（超时/已过期）时消息已经消失会让人以为什么都没发生，
   * 保留到服务端确认后再从列表里拿掉。
   */
  async function recallMessage(item: ChatMessage) {
    if (item.id.startsWith("local-") || item.id.startsWith("pending-")) return;
    Alert.alert(t("messages.recallConfirm"), undefined, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("messages.recall"),
        style: "destructive",
        onPress: () => {
          void (async () => {
            try {
              await apiFetch(`/messages/${item.id}`, { method: "DELETE" });
              setMessages((previous) => previous.filter((message) => message.id !== item.id));
            } catch (recallError) {
              setError(
                recallError instanceof ApiRequestError && recallError.code === "DELETE_EXPIRED"
                  ? t("messages.recallExpired")
                  : t("messages.recallFailed"),
              );
            }
          })();
        },
      },
    ]);
  }

  /*
   * 实时状态只在**不健康**时显示一行：正常连着不该占地方。
   * 文案只描述连接状态，不说「发不出去」—— 发送走 REST，与这条长连接无关。
   */
  const liveBanner =
    liveState === "live" ? null : (
      <Text style={styles.liveState}>
        {t(
          liveState === "connecting"
            ? "messages.liveConnecting"
            : liveState === "reconnecting"
              ? "messages.liveReconnecting"
              : "messages.liveOffline",
        )}
      </Text>
    );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (ai) {
    /* 退出时补拉：AI 页在加载时已经把 lastReadAt 推到现在了，这一拉就把红点消掉。 */
    return (
      <AiScreen
        onBack={() => {
          setAi(false);
          void loadConversations();
        }}
      />
    );
  }

  if (segment === "notifications") {
    return (
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t("messages.title")}</Text>
        </View>
        <Segments value={segment} onChange={setSegment} />
        <NotificationsScreen
          onOpen={(item) => {
            /*
             * 会话类通知：直接打开那个会话。
             *
             * 动态类通知（点赞/评论/收到花）：这一屏够不着「动态」tab，
             * 所以发一条跳转信号给 `App.tsx`（见 `lib/nav-intent.ts`）。
             */
            const conversationId = conversationIdFromNotification(item.data);
            if (conversationId) {
              setSegment("conversations");
              void openConversation(conversationId);
              return true;
            }
            const momentId = momentIdFromNotification(item.data);
            if (momentId) {
              navigateTo({ tab: "moments", momentId });
              return true;
            }
            return false;
          }}
          onBack={() => setSegment("conversations")}
        />
      </View>
    );
  }

  /*
   * 交换联系方式：从会话头部进去的全屏子页。
   *
   * 放在会话分支**之前**：它比会话本身更靠前，返回时回到会话而不是回到列表。
   * `openId` 就是它的入参 —— 列表态（没有会话）不会走到这里。
   */
  if (openId && exchange) {
    return <ExchangeScreen conversationId={openId} onBack={() => setExchange(false)} />;
  }

  if (openId) {
    const conversation = conversations.find((item) => item.id === openId) ?? null;
    const peer = conversation?.peer ?? null;
    /** AI 会话没有真正的「对方」，不显示已读回执。 */
    const isAiConversation = conversation?.type === "AI";
    /* 最后一条已落库的、我发的消息：已读回执只标在它下面。 */
    const lastMineId =
      [...messages].reverse().find((item) => item.senderId === user?.id && !item.local)?.id ?? null;
    return (
      <>
      <KeyboardAware style={styles.root} iosOffset={8}>
        <View style={styles.threadHead}>
          <Pressable
            onPress={() => {
              setOpenId(null);
              setExchange(false);
              void loadConversations();
            }}
            accessibilityRole="button"
            accessibilityLabel={t("messages.backToList")}
            style={styles.backButton}
              hitSlop={10}
            >
            <Icon name="chevron-back" size={22} color={colors.ink} />
          </Pressable>
          <Avatar uri={peer?.avatarUrl ?? null} nickname={peer?.nickname ?? null} size={32} />
          <Text style={styles.threadName} numberOfLines={1}>
            {peer?.nickname ?? t("messages.conversationFallback")}
          </Text>
          {/* 交换入口与 web 头部那条 `🔗 交换联系方式` 同位同义。门槛、能不能点
              都由交换页自己按服务端的 `eligible` 说，这里不预先藏起来 —— 否则
              用户无从知道「聊够就能换」这条规则。 */}
          <Pressable
            onPress={() => setExchange(true)}
            accessibilityRole="button"
            accessibilityLabel={t("exchange.entry")}
            style={styles.exchangeButton}
          >
            <Icon name="link-outline" size={14} color={colors.primaryDark} />
            <Text style={styles.exchangeLabel}>{t("exchange.entry")}</Text>
          </Pressable>
        </View>

        {liveBanner}

        <FlatList
          ref={threadListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.threadList}
          onStartReached={loadOlder}
          onStartReachedThreshold={0.3}
          /*
           * 停在最新一条：打开会话、来新消息、自己发出一条时都滚到底。
           * 只有用户明确往上翻（离底部超过 80px）才停止跟随 —— 否则读旧消息会被拽回去。
           */
          onContentSizeChange={() => {
            if (stickToBottom.current) threadListRef.current?.scrollToEnd({ animated: false });
          }}
          onScroll={(event) => {
            const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
            const distanceToBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
            stickToBottom.current = distanceToBottom < 80;
          }}
          scrollEventThrottle={100}
          /* 往上加载更早的消息时保持可见位置，不跳。 */
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          ListHeaderComponent={
            cursor ? (
              <Pressable onPress={() => void loadOlder()} style={styles.loadOlder}>
                <Text style={styles.loadOlderText}>{t("messages.loadOlder")}</Text>
              </Pressable>
            ) : null
          }
          renderItem={({ item }) => {
            const mine = item.senderId === user?.id;
            /*
             * 已读回执只标在「我发出的最后一条」上：每条都标会把列表变成状态栏，
             * 而人真正关心的只有「对方看到我刚才那句没有」。
             */
            const showReceipt =
              !item.local && mine && item.id === lastMineId && !isAiConversation && peer !== null;
            const receiptRead = peerReadAt
              ? new Date(peerReadAt).getTime() >= new Date(item.createdAt).getTime()
              : false;
            return (
              <View>
              <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : null]}>
                {item.type === "AUDIO" ? (
                  /*
                   * 语音不自带气泡底：`VoiceNote` 本身就是一条带底色的语音条（微信那种），
                   * 再套一层聊天气泡就变成「气泡里装气泡」。
                   */
                  <VoiceNote
                    uri={item.content}
                    playLabel={t("messages.voicePlay")}
                    pauseLabel={t("messages.voicePause")}
                    onLongPress={() => openMessageActions(item)}
                  />
                ) : (
                <Pressable
                  onLongPress={() => openMessageActions(item)}
                  onPress={item.failed ? () => void resendMessage(item) : undefined}
                  delayLongPress={400}
                  style={[
                    styles.bubble,
                    mine ? styles.bubbleMine : styles.bubbleTheirs,
                    item.failed ? styles.bubbleFailed : null,
                  ]}
                >
                  {item.replyTo ? (
                    <View style={[styles.quote, mine ? styles.quoteMine : styles.quoteTheirs]}>
                      <Text
                        style={[styles.quoteName, mine ? styles.quoteNameMine : null]}
                        numberOfLines={1}
                      >
                        {item.replyTo.senderId === user?.id
                          ? t("messages.you")
                          : peer?.nickname ?? t("messages.conversationFallback")}
                      </Text>
                      <Text
                        style={[styles.quoteText, mine ? styles.quoteTextMine : null]}
                        numberOfLines={1}
                      >
                        {quotePreview(item.replyTo, t)}
                      </Text>
                    </View>
                  ) : null}
                  {item.type === "IMAGE" ? (
                    <Image
                      source={{ uri: item.content }}
                      style={styles.bubbleImage}
                      resizeMode="cover"
                      accessibilityLabel={t("messages.imagePreview")}
                    />
                  ) : item.type === "VIDEO" ? (
                    <Pressable
                      onPress={() => setPlayingVideo(item.content)}
                      accessibilityRole="button"
                      accessibilityLabel={t("messages.playVideo")}
                      style={styles.bubbleVideo}
                    >
                      <Icon name="play" size={26} color={colors.white} />
                      <Text style={styles.bubbleVideoLabel}>{t("messages.videoPreview")}</Text>
                    </Pressable>
                  ) : (
                    <Text style={mine ? styles.bubbleTextMine : styles.bubbleTextTheirs}>{item.content}</Text>
                  )}
                  {item.failed ? (
                    <Text style={styles.failedText}>{t("messages.tapToRetry")}</Text>
                  ) : null}
                  {/*
                   * 翻译（与网页同接口 POST /messages/:id/translate）。
                   * 只给「别人发的、已经落库的」消息加：自己发的不需要翻，
                   * 以 `local-`/`pending-` 开头的是本地乐观条目，服务端没有这条 id。
                   */}
                  {!mine && !item.id.startsWith("local-") && !item.id.startsWith("pending-") ? (
                    translations[item.id] ? (
                      <Text style={styles.translationText}>{translations[item.id]}</Text>
                    ) : (
                      <Pressable
                        onPress={() => void translateMessage(item.id)}
                        disabled={translatingId === item.id}
                        accessibilityRole="button"
                        accessibilityLabel={t("messages.translate")}
                        hitSlop={8}
                        style={styles.translateLink}
                      >
                        <Text style={styles.translateText}>
                          {translatingId === item.id ? t("messages.translating") : t("messages.translate")}
                        </Text>
                      </Pressable>
                    )
                  ) : null}
                </Pressable>
                )}
              </View>
                {showReceipt ? (
                  <Text style={[styles.readReceipt, styles.readReceiptMine]}>
                    {receiptRead ? t("messages.read") : t("messages.unread")}
                  </Text>
                ) : null}
              </View>
            );
          }}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {/* 对方正在输入：贴着输入框上沿，不挤压消息列表。 */}
        {peerTyping ? <Text style={styles.typingLine}>{t("messages.typing")}</Text> : null}

        {replyTarget ? (
          <View style={styles.replyBar}>
            <View style={styles.replyBarBody}>
              <Text style={styles.replyBarName} numberOfLines={1}>
                {replyTarget.senderId === user?.id
                  ? t("messages.you")
                  : peer?.nickname ?? t("messages.conversationFallback")}
              </Text>
              <Text style={styles.replyBarText} numberOfLines={1}>
                {quotePreview(replyTarget, t)}
              </Text>
            </View>
            <Pressable
              onPress={() => setReplyTarget(null)}
              accessibilityRole="button"
              accessibilityLabel={t("messages.cancelReply")}
              hitSlop={8}
              style={styles.replyBarClose}
            >
              <Icon name="close" size={16} color={colors.muted} />
            </Pressable>
          </View>
        ) : null}

        {/* 选好的媒体贴在输入框上方：输入框还能继续用来补一句话。 */}
        {pending ? (
          <MediaPreviewBar
            media={{
              kind: pending.kind,
              uri: pending.asset.uri,
              width: pending.asset.width,
              height: pending.asset.height,
              sizeBytes: pending.asset.fileSize,
              durationSec: pending.asset.duration ? pending.asset.duration / 1000 : undefined,
            }}
            uploading={attaching}
            onCancel={() => setPending(null)}
            onSend={() => void sendPendingMedia()}
          />
        ) : null}

        {recording ? (
          /* 录音中：整条输入栏换成计时 + 取消/发送。避免边录边打字，也避免误触发送。 */
          <View style={styles.composer} accessibilityLiveRegion="polite">
            <View style={styles.recordingDot} />
            <Text style={styles.recordingTime}>{formatVoiceDuration(Math.max(1, recordSec))}</Text>
            <Text style={styles.recordingHint} numberOfLines={1}>
              {t("messages.recordingHint")}
            </Text>
            <Pressable
              onPress={() => void stopRecording(false)}
              accessibilityRole="button"
              accessibilityLabel={t("messages.voiceCancel")}
              hitSlop={8}
              style={styles.voiceCancel}
            >
              <Text style={styles.voiceCancelText}>{t("common.cancel")}</Text>
            </Pressable>
            <Pressable
              onPress={() => void stopRecording(true)}
              accessibilityRole="button"
              accessibilityLabel={t("messages.voiceSend")}
              style={styles.sendButton}
            >
              <Text style={styles.sendLabel}>{t("messages.send")}</Text>
            </Pressable>
          </View>
        ) : (
        <View style={styles.composer}>
          <Pressable
            onPress={pickAttachment}
            disabled={attaching}
            accessibilityRole="button"
            accessibilityLabel={t("messages.attach")}
            hitSlop={8}
            style={styles.attachButton}
          >
            {attaching ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : (
              <Icon name="add" size={22} color={colors.primary} />
            )}
          </Pressable>
          <TextInput
            value={draft}
            onChangeText={(value) => {
              setDraft(value);
              // 空输入框不算「正在输入」。对方那边 4 秒没动静会自动清掉（见 chat-socket.ts）。
              setTyping(value.trim().length > 0);
            }}
            placeholder={t("messages.composerPlaceholder")}
            placeholderTextColor={colors.muted}
            style={styles.input}
            maxLength={2000}
            multiline
            accessibilityLabel={t("messages.composerLabel")}
          />
          {draft.trim() ? (
            <Pressable
              onPress={() => void send()}
              disabled={sending}
              accessibilityRole="button"
              accessibilityLabel={t("messages.send")}
              style={[styles.sendButton, sending ? styles.sendDisabled : null]}
            >
              {sending ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <>
                  <Icon name="arrow-up" size={16} color={colors.white} />
                  {/* 文字一定在：图标字体没就位时，这枚按钮也不该只剩一个色块。 */}
                  <Text style={styles.sendLabel}>{t("messages.send")}</Text>
                </>
              )}
            </Pressable>
          ) : (
            /*
             * 输入框空着时，右侧是「录音」而不是「发送」—— 同一个位置只放一个
             * 主操作：有字就发字，没字就发语音。这是微信/Telegram 的默认心智，
             * 也省掉了在窄屏上再塞一个按钮。
             */
            <Pressable
              onPress={() => void startRecording()}
              disabled={voiceSending}
              accessibilityRole="button"
              accessibilityLabel={t("messages.voiceRecord")}
              style={[styles.micButton, voiceSending ? styles.sendDisabled : null]}
            >
              {voiceSending ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <Icon name="mic" size={20} color={colors.primary} />
              )}
            </Pressable>
          )}
        </View>
        )}
      </KeyboardAware>
      <AttachmentSheet
        visible={attachOpen}
        onClose={() => setAttachOpen(false)}
        onPickImage={() => void sendPicked("image")}
        onPickVideo={() => void sendPicked("video")}
      />
      {playingVideo ? (
        <ChatVideoPlayer uri={playingVideo} onClose={() => setPlayingVideo(null)} />
      ) : null}
      </>
    );
  }

  /*
   * AI 会话不进这个列表。
   *
   * 它与真人会话长得很像，但发消息走的是 `/ai-companion`；走普通会话接口会被服务端
   * 以 404 CONVERSATION_NOT_FOUND 拒掉（2026-10-21 线上反馈：点列表里的 AI 会话
   * 发消息就报这个）。web 端一直把 AI 单独拆出来指向 `/ai`，App 之前没拆。
   */
  const { ai: aiChat, humans: humanChats } = splitConversations(conversations);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t("messages.title")}</Text>
      </View>
      <Segments value={segment} onChange={setSegment} />
      {liveBanner}
      <FlatList
        data={humanChats}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        /*
         * AI 朋友入口固定在列表顶部（与 web 的 /messages 顶部那条入口同位置）。
         * 放在 ListHeaderComponent 而不是列表数据里：它不是一个会话，
         * 混进数据会让「没有会话」时的空状态失效。
         */
        ListHeaderComponent={
          <View>
            {/*
             * 收到的连接申请。
             *
             * web 一直在消息页顶部列这一块，App 之前只有「向别人打招呼」，没有接收端 ——
             * 结果是两个 App 用户之间永远开不了会话（服务端要 PENDING → 接受 才建会话）。
             */}
            {incoming.length > 0 ? (
              <View style={styles.requests}>
                <Text style={styles.requestsTitle}>{t("messages.requestsTitle")}</Text>
                {incoming.map((request) => (
                  <View key={request.id} style={styles.requestRow}>
                    <Avatar
                      uri={request.sender?.avatarUrl ?? null}
                      nickname={request.sender?.nickname ?? null}
                      size={40}
                    />
                    <View style={styles.rowText}>
                      <Text style={styles.peerName} numberOfLines={1}>
                        {request.sender?.nickname ?? t("common.talkfirstUser")}
                      </Text>
                      <Text style={styles.preview} numberOfLines={2}>
                        {request.message?.trim() || t("messages.requestNoMessage")}
                      </Text>
                    </View>
                    <View style={styles.requestActions}>
                      <Pressable
                        onPress={() => void respondRequest(request.id, "accept")}
                        disabled={actingId === request.id}
                        accessibilityRole="button"
                        accessibilityLabel={t("messages.requestAccept")}
                        style={styles.acceptButton}
                      >
                        <Text style={styles.acceptText}>{t("messages.requestAccept")}</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => void respondRequest(request.id, "reject")}
                        disabled={actingId === request.id}
                        accessibilityRole="button"
                        accessibilityLabel={t("messages.requestReject")}
                        style={styles.rejectButton}
                      >
                        <Text style={styles.rejectText}>{t("messages.requestReject")}</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
            <Pressable
              onPress={openAi}
              accessibilityRole="button"
              accessibilityLabel={t("ai.title")}
              style={styles.aiEntry}
            >
              <View style={styles.aiIcon}>
                <Icon name="sparkles-outline" size={20} color={colors.primaryDark} />
              </View>
              <View style={styles.rowText}>
                <Text
                  style={[styles.peerName, aiChat?.unreadCount ? styles.peerNameUnread : null]}
                  numberOfLines={1}
                >
                  {aiChat?.aiCompanionName ?? t("ai.title")}
                </Text>
                <Text
                  style={[styles.preview, aiChat?.unreadCount ? styles.previewUnread : null]}
                  numberOfLines={1}
                >
                  {aiChat?.lastMessage?.content ?? t("ai.entryHint")}
                </Text>
              </View>
              <UnreadBadge count={aiChat?.unreadCount ?? 0} />
              {aiChat?.unreadCount ? null : (
                <Icon name="chevron-forward" size={18} color={colors.muted} />
              )}
            </Pressable>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Icon name="chatbubbles-outline" size={32} color={colors.muted} />
            <Text style={styles.emptyText}>{t("messages.empty")}</Text>
          </View>
        }
        renderItem={({ item }) => {
          /* 已读/未读三个信号：名字字重、预览颜色、时间颜色。只有徽标的话，
             一眼看过去整列长得一模一样 —— 这正是之前「分不出来」的原因。 */
          const unread = (item.unreadCount ?? 0) > 0;
          return (
            <Pressable
              onPress={() => void openConversation(item.id)}
              accessibilityRole="button"
              style={styles.row}
            >
              <Avatar uri={item.peer?.avatarUrl ?? null} nickname={item.peer?.nickname ?? null} size={48} />
              <View style={styles.rowText}>
                <View style={styles.rowTop}>
                  <Text
                    style={[styles.peerName, unread ? styles.peerNameUnread : null]}
                    numberOfLines={1}
                  >
                    {item.peer?.nickname ?? t("messages.conversationFallback")}
                  </Text>
                  <Text style={[styles.time, unread ? styles.timeUnread : null]}>
                    {compactTime(item.lastMessage?.createdAt ?? item.updatedAt, t)}
                  </Text>
                </View>
                <Text style={[styles.preview, unread ? styles.previewUnread : null]} numberOfLines={1}>
                  {previewText(item, t)}
                </Text>
              </View>
              <UnreadBadge count={item.unreadCount ?? 0} />
            </Pressable>
          );
        }}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

/**
 * 附件消息在列表里的占位文案；文字消息直接显示正文。
 */
const MEDIA_PREVIEW = {
  IMAGE: "messages.imagePreview",
  VIDEO: "messages.videoPreview",
  AUDIO: "messages.voicePreview",
} as const;

/** 引用条里的一行摘要；被引用方已撤回时只说「消息已撤回」，不把 URL 露出来。 */
function quotePreview(quote: MessageQuote, t: TranslateFn): string {
  if (quote.deletedAt) return t("messages.recalled");
  const key = MEDIA_PREVIEW[quote.type as keyof typeof MEDIA_PREVIEW];
  return key ? t(key) : quote.content;
}

function previewText(item: ConversationItem, t: TranslateFn): string {
  if (!item.lastMessage) return t("messages.startChat");
  const key = MEDIA_PREVIEW[item.lastMessage.type as keyof typeof MEDIA_PREVIEW];
  return key ? t(key) : item.lastMessage.content;
}

/**
 * 把人机会话分开。
 *
 * AI 会话和真人会话在列表里长得一样，但消息走的是两套接口：AI 只能走
 * `/ai-companion`，走 `/conversations/:id/messages` 会被服务端 404
 * `CONVERSATION_NOT_FOUND`（2026-10-21 线上反馈）。web 端一直是分开的
 * （`aiChat` → `/ai`，`humanChats` → 列表），App 这里对齐。
 */
export function splitConversations(items: ConversationItem[]): {
  ai: ConversationItem | null;
  humans: ConversationItem[];
} {
  return {
    ai: items.find((item) => item.type === "AI") ?? null,
    humans: items.filter((item) => item.type !== "AI"),
  };
}

/**
 * 通知的 `data` 是一段 JSON 字符串（服务端存的负载），从中拿会话 id。
 *
 * `parse` 包在 try 里：老通知的 `data` 可能为 null、也可能是不带会话的
 * 负载（动态点赞之类）。拿不到就返回 null，让调用方只标已读 ——
 * 解析失败绝不能把「点通知」变成一次崩溃。
 */
export function conversationIdFromNotification(data: string | null): string | null {
  if (!data) return null;
  try {
    const parsed = JSON.parse(data) as { conversationId?: unknown };
    return typeof parsed.conversationId === "string" && parsed.conversationId.length > 0
      ? parsed.conversationId
      : null;
  } catch {
    return null;
  }
}

/**
 * 动态类通知的 `data`（`{ targetType: "MOMENT", targetId }`）里取出动态 id。
 *
 * 与 `conversationIdFromNotification` 同一个套路：解析失败一律 null，
 * 让调用方只标已读 —— 点一条通知不能把 App 点崩。
 */
export function momentIdFromNotification(data: string | null): string | null {
  if (!data) return null;
  try {
    const parsed = JSON.parse(data) as { targetType?: unknown; targetId?: unknown };
    if (parsed.targetType !== "MOMENT") return null;
    return typeof parsed.targetId === "string" && parsed.targetId.length > 0
      ? parsed.targetId
      : null;
  } catch {
    return null;
  }
}

/** 会话列表右侧那个时间：与 `MomentsScreen.relativeTime` 同形状，`t` 由调用方传入。 */
function compactTime(iso: string, t: TranslateFn): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return t("common.justNow");
  if (minutes < 60) return t("common.minutesAgo", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("common.hoursAgo", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("common.daysAgo", { n: days });
  return date.toLocaleDateString();
}

/** 会话 / 通知的分段控件（两个分段而已，不值得引入组件库）。 */
function Segments({
  value,
  onChange,
}: {
  value: "conversations" | "notifications";
  onChange: (next: "conversations" | "notifications") => void;
}) {
  const { t } = useI18n();
  const options: ["conversations" | "notifications", MsgKey][] = [
    ["conversations", "messages.title"],
    ["notifications", "tab.notifications"],
  ];

  return (
    <View style={styles.segments}>
      {options.map(([id, labelKey]) => {
        const active = value === id;
        return (
          <Pressable
            key={id}
            onPress={() => onChange(id)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={t(labelKey)}
            style={[styles.segment, active ? styles.segmentActive : null]}
          >
            <Text style={[styles.segmentLabel, active ? styles.segmentLabelActive : null]}>
              {t(labelKey)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * 全屏视频播放。
 *
 * 为什么不在气泡里直接播：一个会话可能有几十条视频，每条都挂一个播放器实例既费内存，
 * 也会让列表滚动掉帧。气泡只显示一个「播放」入口，点开才创建播放器。
 */
function ChatVideoPlayer({ uri, onClose }: { uri: string; onClose: () => void }) {
  const { t } = useI18n();
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
    instance.play();
  });

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.videoRoot}>
        <VideoView player={player} style={styles.videoFull} contentFit="contain" nativeControls />
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
          hitSlop={12}
          style={styles.videoClose}
        >
          <Icon name="close" size={22} color={colors.white} />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = themed((c) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 10 },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  segments: { flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingBottom: 10 },
  segment: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radii.pill,
    backgroundColor: c.bgSoft,
  },
  segmentActive: { backgroundColor: c.primary },
  segmentLabel: { fontSize: sizes.ui, fontWeight: "600", color: c.muted },
  segmentLabelActive: { color: c.white },
  headerTitle: { fontSize: sizes.title, fontWeight: "700", color: c.ink },
  list: { paddingHorizontal: 12, paddingBottom: 24 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 8 },
  rowText: { flex: 1 },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  peerName: { flex: 1, fontSize: sizes.body, fontWeight: "500", color: c.ink },
  peerNameUnread: { fontWeight: "700" },
  time: { fontSize: sizes.caption, color: c.muted },
  timeUnread: { color: c.primary, fontWeight: "600" },
  preview: { fontSize: sizes.ui, color: c.muted, marginTop: 3 },
  previewUnread: { color: c.ink },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: radii.chip,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.danger,
  },
  unreadText: { fontSize: sizes.caption, fontWeight: "700", color: c.white },
  threadHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    // 同 ComposeScreen：顶部安全区已由 App.tsx 统一留白，这里不再写死 54。
    paddingTop: 12,
    paddingBottom: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: c.line,
  },
  backButton: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  threadName: { flex: 1, fontSize: sizes.body, fontWeight: "600", color: c.ink },
  exchangeButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radii.chip,
    backgroundColor: c.bgTint,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  exchangeLabel: { fontSize: sizes.caption, fontWeight: "600", color: c.primaryDark },
  threadList: { padding: 14, gap: 8 },
  loadOlder: { alignItems: "center", paddingVertical: 10 },
  loadOlderText: { fontSize: sizes.ui, color: c.primary },
  bubbleRow: { flexDirection: "row" },
  bubbleRowMine: { justifyContent: "flex-end" },
  bubble: { maxWidth: "78%", borderRadius: radii.control, paddingHorizontal: 12, paddingVertical: 9 },
  bubbleMine: { backgroundColor: c.primary, borderBottomRightRadius: 5 },
  bubbleTheirs: { backgroundColor: c.bgTint, borderBottomLeftRadius: 5 },
  bubbleTextMine: { fontSize: sizes.body, lineHeight: 21, color: c.white },
  bubbleTextTheirs: { fontSize: sizes.body, lineHeight: 21, color: c.ink },
  /* 附件气泡：固定 220 宽，列表里高度可预测、不会被原图撑破。 */
  bubbleImage: { width: 220, height: 165, borderRadius: radii.chip },
  bubbleVideo: {
    width: 220,
    height: 140,
    borderRadius: radii.chip,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  bubbleVideoLabel: { fontSize: sizes.caption, fontWeight: "600", color: c.white },
  attachButton: {
    width: 40,
    height: 40,
    borderRadius: radii.chip,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.bgSoft,
    borderWidth: 1,
    borderColor: c.line,
  },
  /* 录音态：一个红点 + 计时 + 取消/发送，占满整条输入栏。 */
  micButton: {
    width: 40,
    height: 40,
    borderRadius: radii.card,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.bgSoft,
    borderWidth: 1,
    borderColor: c.line,
  },
  recordingDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.danger },
  recordingTime: { fontSize: sizes.ui, fontWeight: "600", color: c.ink, fontVariant: ["tabular-nums"] },
  recordingHint: { flex: 1, fontSize: sizes.caption, color: c.muted },
  voiceCancel: { paddingHorizontal: 8, paddingVertical: 8 },
  voiceCancelText: { fontSize: sizes.ui, fontWeight: "600", color: c.muted },
  videoRoot: { flex: 1, backgroundColor: "#000" },
  videoFull: { flex: 1 },
  videoClose: {
    position: "absolute",
    top: 48,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  /* 引用条与已读回执（2026-11-08）。 */
  quote: { marginBottom: 6, paddingLeft: 8, borderLeftWidth: 3, borderRadius: 2 },
  quoteMine: { borderLeftColor: "rgba(255,255,255,0.55)" },
  quoteTheirs: { borderLeftColor: c.primary },
  quoteName: { fontSize: sizes.caption, fontWeight: "600", color: c.primaryDark },
  quoteNameMine: { color: "rgba(255,255,255,0.85)" },
  quoteText: { fontSize: sizes.caption, color: c.muted },
  quoteTextMine: { color: "rgba(255,255,255,0.8)" },
  bubbleFailed: { opacity: 0.55 },
  /* 失败提示只在「我的」气泡里出现（乐观消息总是自己发的），所以用白色。 */
  failedText: { marginTop: 4, fontSize: sizes.caption, color: c.white, fontWeight: "600" },
  readReceipt: { marginTop: 2, marginRight: 4, fontSize: sizes.caption, color: c.muted, textAlign: "right" },
  readReceiptMine: { textAlign: "right" },
  replyBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 10,
    marginBottom: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radii.chip,
    backgroundColor: c.bgTint,
    borderLeftWidth: 3,
    borderLeftColor: c.primary,
  },
  replyBarBody: { flex: 1 },
  replyBarName: { fontSize: sizes.caption, fontWeight: "600", color: c.primaryDark },
  replyBarText: { fontSize: sizes.caption, color: c.muted },
  replyBarClose: { padding: 4 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: c.line,
    backgroundColor: c.glass,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 40,
    borderRadius: radii.card,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: c.bgSoft,
    color: c.ink,
    fontSize: sizes.body,
  },
  sendButton: {
    /* 同 AI 页：不再做成纯图标圆点，图标缺字形时按钮仍可读。 */
    minWidth: 72,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: radii.card,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.primary,
  },
  sendLabel: { color: c.white, fontSize: sizes.ui, fontWeight: "600" },
  translateLink: { marginTop: 6 },
  translateText: { fontSize: sizes.caption, color: c.primaryDark, fontWeight: "600" },
  translationText: { marginTop: 6, fontSize: sizes.ui, lineHeight: 19, color: c.muted },
  requests: { marginBottom: 12 },
  requestsTitle: { fontSize: sizes.caption, fontWeight: "600", color: c.muted, marginBottom: 6, paddingHorizontal: 4 },
  requestRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    marginBottom: 8,
    borderRadius: radii.chip,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.glass,
  },
  requestActions: { gap: 6 },
  acceptButton: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radii.chip,
    backgroundColor: c.primary,
  },
  acceptText: { color: c.white, fontSize: sizes.caption, fontWeight: "600" },
  rejectButton: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radii.chip,
    borderWidth: 1,
    borderColor: c.line,
  },
  rejectText: { color: c.muted, fontSize: sizes.caption, fontWeight: "600" },
  sendDisabled: { opacity: 0.45 },
  emptyText: { fontSize: sizes.ui, color: c.muted, textAlign: "center", lineHeight: 21 },
  error: { position: "absolute", left: 16, right: 16, bottom: 96, fontSize: sizes.ui, color: c.danger, textAlign: "center" },
  typingLine: { position: "absolute", left: 16, right: 16, bottom: 62, fontSize: sizes.caption, color: c.muted },
  liveState: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    fontSize: sizes.caption,
    color: c.muted,
    textAlign: "center",
  },
  aiEntry: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    marginBottom: 8,
    borderRadius: radii.chip,
    backgroundColor: c.bgTint,
  },
  aiIcon: {
    width: 44,
    height: 44,
    borderRadius: radii.card,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.glass,
  },
}));
