"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Settings2, Sparkles, Trash2 } from "lucide-react";
import { PhoneShell } from "@/components/phone-shell";
import { TabBar } from "@/components/tab-bar";
import {
  TFAvatar,
  TFButton,
  TFErrorState,
  TFLoadingRegion,
  TFRowSkeleton,
  TFDialog,
  TFInput,
  TFTextarea,
  useToast,
} from "@/components/tf";
import { ApiRequestError, apiFetch } from "@/lib/api";
import { localePath, type MsgKey } from "@/lib/i18n";
import { useT } from "@/lib/i18n/use-locale";
import { cn } from "@/lib/cn";

/**
 * AI 朋友 —— 一个人专属、可定制人设的 AI 聊天伙伴。
 *
 * 与真人会话不同：AI 会话不走实时网关，发消息用 `POST /ai-companion/messages`，
 * 服务端在同一次请求里生成并落库 AI 回复（`{ message, reply }`）。所以这里没有
 * WebSocket，只需要轮询自己的状态机：发送中 → 收到回复 / 回复失败（可重试）。
 */

type AiMessage = {
  id: string;
  senderId: string | null;
  senderKind: "USER" | "AI";
  content: string;
  createdAt: string;
};

type Companion = {
  id: string;
  name: string;
  userNickname: string;
  stylePreset: string | null;
  personality: string | null;
  greeting: string | null;
};

type CompanionState = {
  companion: Companion;
  conversationId: string | null;
  messages: AiMessage[];
};

const STYLE_OPTIONS: Array<{ key: string; labelKey: MsgKey }> = [
  { key: "gentle", labelKey: "ai.styleGentle" },
  { key: "witty", labelKey: "ai.styleWitty" },
  { key: "calm", labelKey: "ai.styleCalm" },
  { key: "energetic", labelKey: "ai.styleEnergetic" },
  { key: "warm", labelKey: "ai.styleWarm" },
  { key: "listener", labelKey: "ai.styleListener" },
];

export default function AiPage() {
  const { locale, t } = useT();
  const { show: toast } = useToast();
  const [state, setState] = useState<CompanionState | null | undefined>(undefined);
  const [loadError, setLoadError] = useState("");
  const [view, setView] = useState<"chat" | "settings">("chat");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [failedAfterId, setFailedAfterId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<CompanionState | null>("/ai-companion");
      setState(data ?? null);
      setLoadError("");
      if (data?.conversationId) {
        void apiFetch(`/ai-companion/messages/read`, { method: "POST" }).catch(() => undefined);
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t("ai.loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state?.messages.length, sending]);

  const companion = state?.companion;

  async function send() {
    const content = draft.trim();
    if (!content || sending || !state?.conversationId) return;
    setDraft("");
    setSending(true);
    setFailedAfterId(null);
    const optimistic: AiMessage = {
      id: `pending-${Date.now()}`,
      senderId: "me",
      senderKind: "USER",
      content,
      createdAt: new Date().toISOString(),
    };
    setState((prev) => (prev ? { ...prev, messages: [...prev.messages, optimistic] } : prev));
    try {
      const result = await apiFetch<{ message: AiMessage; reply: AiMessage | null }>("/ai-companion/messages", {
        method: "POST",
        body: { content },
      });
      setState((prev) => {
        if (!prev) return prev;
        const withoutPending = prev.messages.filter((m) => m.id !== optimistic.id);
        return {
          ...prev,
          messages: [...withoutPending, result.message, ...(result.reply ? [result.reply] : [])],
        };
      });
      if (!result.reply) setFailedAfterId(result.message.id);
    } catch (error) {
      setState((prev) => (prev ? { ...prev, messages: prev.messages.filter((m) => m.id !== optimistic.id) } : prev));
      setDraft(content);
      setFailedAfterId(null);
      if (error instanceof ApiRequestError && error.code === "AI_NOT_CONFIGURED") {
        toast({ message: t("ai.notConfigured"), tone: "error" });
      } else {
        toast({ message: t("ai.sendFailed"), tone: "error" });
      }
    } finally {
      setSending(false);
    }
  }

  async function retry() {
    if (sending) return;
    setSending(true);
    try {
      const result = await apiFetch<{ message: AiMessage; reply: AiMessage | null }>("/ai-companion/reply", {
        method: "POST",
      });
      const reply = result.reply;
      if (reply) {
        setState((prev) => (prev ? { ...prev, messages: [...prev.messages, reply] } : prev));
        setFailedAfterId(null);
      } else {
        setFailedAfterId(result.message.id);
      }
    } catch (error) {
      toast({
        message:
          error instanceof ApiRequestError && error.code === "AI_NOT_CONFIGURED"
            ? t("ai.notConfigured")
            : t("ai.sendFailed"),
        tone: "error",
      });
    } finally {
      setSending(false);
    }
  }

  const lastMessage = useMemo(() => {
    const msgs = state?.messages ?? [];
    return msgs.length ? msgs[msgs.length - 1] : null;
  }, [state?.messages]);

  /* ─────────────────────────── 渲染 ─────────────────────────── */

  return (
    <PhoneShell>
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-3 py-2.5">
          <Link
            href={localePath(locale, "/messages")}
            aria-label={t("ai.backToMessages")}
            className="grid h-9 w-9 place-items-center rounded-full text-content-muted transition-colors duration-instant hover:bg-surface-sunken hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          >
            <ArrowLeft size={20} aria-hidden="true" />
          </Link>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-100 text-brand-600">
              <Sparkles size={16} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-ui font-semibold text-content">{companion?.name ?? t("ai.title")}</h1>
              <p className="truncate text-overline text-content-subtle">{t("ai.headerSubtitle")}</p>
            </div>
          </div>
          {companion ? (
            <button
              type="button"
              onClick={() => setView((v) => (v === "settings" ? "chat" : "settings"))}
              aria-label={t("ai.settings")}
              className="grid h-9 w-9 place-items-center rounded-full text-content-muted transition-colors duration-instant hover:bg-surface-sunken hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
            >
              <Settings2 size={19} aria-hidden="true" />
            </button>
          ) : null}
        </header>

        {state === undefined ? (
          <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-5 py-6">
            <TFLoadingRegion label={t("ai.loading")}>
              <div className="mt-5 space-y-3">
                <TFRowSkeleton />
                <TFRowSkeleton />
              </div>
            </TFLoadingRegion>
          </div>
        ) : null}

        {state !== undefined && loadError ? (
          <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-5 py-6">
            <TFErrorState description={loadError} onRetry={() => void load()} />
          </div>
        ) : null}

        {state !== undefined && !loadError && state === null ? (
          <SetupForm
            t={t}
            onSaved={(next) => {
              setState(next);
              setView("chat");
              toast({ message: t("ai.created"), tone: "success" });
            }}
          />
        ) : null}

        {state !== undefined && !loadError && state && view === "settings" ? (
          <SetupForm
            t={t}
            initial={state.companion}
            onSaved={(next) => {
              setState(next);
              setView("chat");
              toast({ message: t("ai.saved"), tone: "success" });
            }}
            onDelete={() => setConfirmDelete(true)}
          />
        ) : null}

        {state !== undefined && !loadError && state && view === "chat" ? (
          <>
            <div ref={listRef} className="tf-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {state.messages.length === 0 ? (
                <p className="mt-10 text-center text-caption text-content-muted">{t("ai.emptyHint", { name: state.companion.name })}</p>
              ) : (
                <div className="space-y-3">
                  {state.messages.map((message) => (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      name={state.companion.name}
                      t={t}
                      isLast={message.id === lastMessage?.id}
                      failed={failedAfterId === message.id}
                      sending={sending}
                      onRetry={() => void retry()}
                    />
                  ))}
                  {sending ? <TypingBubble name={state.companion.name} t={t} /> : null}
                </div>
              )}
            </div>

            <div className="shrink-0 border-t border-border bg-surface px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2.5">
              <form
                className="flex items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send();
                }}
              >
                <label htmlFor="ai-draft" className="sr-only">
                  {t("ai.inputPlaceholder", { name: state.companion.name })}
                </label>
                <textarea
                  id="ai-draft"
                  rows={1}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={t("ai.inputPlaceholder", { name: state.companion.name })}
                  maxLength={2000}
                  className="max-h-28 min-h-11 flex-1 resize-none rounded-control border border-border bg-surface px-3.5 py-2.5 text-ui text-content placeholder:text-content-subtle focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                />
                <TFButton type="submit" disabled={!draft.trim() || sending} loading={sending} loadingLabel={t("common.sending")}>
                  {t("ai.send")}
                </TFButton>
              </form>
            </div>
          </>
        ) : null}
      </div>

      <TFDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t("ai.deleteConfirmTitle", { name: companion?.name ?? "" })}
        description={t("ai.deleteConfirmBody")}
        footer={
          <>
            <TFButton variant="secondary" className="flex-1" onClick={() => setConfirmDelete(false)}>
              {t("common.cancel")}
            </TFButton>
            <TFButton
              className="flex-1"
              onClick={async () => {
                setConfirmDelete(false);
                try {
                  await apiFetch("/ai-companion", { method: "DELETE" });
                  setState(null);
                  setView("chat");
                  toast({ message: t("ai.deleted"), tone: "success" });
                } catch {
                  toast({ message: t("ai.sendFailed"), tone: "error" });
                }
              }}
            >
              {t("ai.deleteConfirm")}
            </TFButton>
          </>
        }
      />

      <TabBar active="/messages" />
    </PhoneShell>
  );
}

/* ─────────────────────────── 消息气泡 ─────────────────────────── */

function MessageBubble({
  message,
  name,
  t,
  isLast,
  failed,
  sending,
  onRetry,
}: {
  message: AiMessage;
  name: string;
  t: ReturnType<typeof useT>["t"];
  isLast: boolean;
  failed: boolean;
  sending: boolean;
  onRetry: () => void;
}) {
  const isAi = message.senderKind === "AI";
  return (
    <div className={cn("flex items-end gap-2", isAi ? "justify-start" : "justify-end")}>
      {isAi ? (
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-100 text-brand-600">
          <Sparkles size={14} aria-hidden="true" />
        </span>
      ) : null}
      <div className={cn("max-w-[76%]")}>
        {isAi ? <p className="mb-1 text-overline text-content-subtle">{name}</p> : null}
        <div
          className={cn(
            "whitespace-pre-wrap break-words rounded-card px-3.5 py-2.5 text-ui leading-5",
            isAi ? "rounded-tl-none border border-border bg-surface text-content" : "rounded-br-none bg-brand-500 text-white",
          )}
        >
          {message.content}
        </div>
        {failed && isLast && !sending ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-1 text-caption font-medium text-brand-600 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          >
            {t("ai.retry")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function TypingBubble({ name, t }: { name: string; t: ReturnType<typeof useT>["t"] }) {
  return (
    <div className="flex items-end gap-2">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-100 text-brand-600">
        <Sparkles size={14} aria-hidden="true" />
      </span>
      <div>
        <p className="mb-1 text-overline text-content-subtle">{name}</p>
        <div className="flex items-center gap-1 rounded-card rounded-tl-none border border-border bg-surface px-3.5 py-3">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-content-subtle" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-content-subtle [animation-delay:150ms]" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-content-subtle [animation-delay:300ms]" />
          <span className="sr-only">{t("ai.typing")}</span>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── 创建 / 设定表单 ─────────────────────────── */

function SetupForm({
  t,
  initial,
  onSaved,
  onDelete,
}: {
  t: ReturnType<typeof useT>["t"];
  initial?: Companion;
  onSaved: (next: CompanionState) => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [userNickname, setUserNickname] = useState(initial?.userNickname ?? "");
  const [stylePreset, setStylePreset] = useState<string | null>(initial?.stylePreset ?? null);
  const [personality, setPersonality] = useState(initial?.personality ?? "");
  const [greeting, setGreeting] = useState(initial?.greeting ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { show: toast } = useToast();

  const editing = Boolean(initial);

  async function submit() {
    if (!name.trim() || !userNickname.trim()) {
      setError(t("ai.errorRequired"));
      return;
    }
    setError("");
    setSaving(true);
    try {
      const next = await apiFetch<CompanionState>("/ai-companion", {
        method: "PUT",
        body: {
          name: name.trim(),
          userNickname: userNickname.trim(),
          stylePreset: stylePreset ?? undefined,
          personality: personality.trim() || undefined,
          greeting: greeting.trim() || undefined,
        },
      });
      onSaved(next);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("ai.sendFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-5 py-6">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-100 text-brand-600">
          <Sparkles size={17} aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-title font-semibold text-content">{editing ? t("ai.settingsTitle") : t("ai.setupTitle")}</h1>
          <p className="mt-1 text-caption leading-5 text-content-muted">{t("ai.setupSubtitle")}</p>
        </div>
      </div>

      <form
        className="mt-6 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="space-y-1.5">
          <label htmlFor="ai-name" className="text-caption font-medium text-content-muted">
            {t("ai.nameLabel")}
          </label>
          <TFInput id="ai-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("ai.namePlaceholder")} maxLength={30} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="ai-nickname" className="text-caption font-medium text-content-muted">
            {t("ai.userNicknameLabel")}
          </label>
          <TFInput
            id="ai-nickname"
            value={userNickname}
            onChange={(e) => setUserNickname(e.target.value)}
            placeholder={t("ai.userNicknamePlaceholder")}
            maxLength={30}
          />
        </div>

        <fieldset>
          <legend className="text-caption font-medium text-content-muted">{t("ai.styleLabel")}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {STYLE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={stylePreset === option.key}
                onClick={() => setStylePreset((current) => (current === option.key ? null : option.key))}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-caption font-medium transition-colors duration-instant focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300",
                  stylePreset === option.key
                    ? "border-brand-500 bg-brand-50 text-brand-700"
                    : "border-border bg-surface text-content-muted hover:bg-surface-sunken",
                )}
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="space-y-1.5">
          <label htmlFor="ai-personality" className="text-caption font-medium text-content-muted">
            {t("ai.personalityLabel")}
          </label>
          <TFTextarea
            id="ai-personality"
            rows={3}
            value={personality}
            onChange={(e) => setPersonality(e.target.value)}
            placeholder={t("ai.personalityPlaceholder")}
            maxLength={500}
          />
        </div>

        {!editing ? (
          <div className="space-y-1.5">
            <label htmlFor="ai-greeting" className="text-caption font-medium text-content-muted">
              {t("ai.greetingLabel")}
            </label>
            <TFTextarea
              id="ai-greeting"
              rows={2}
              value={greeting}
              onChange={(e) => setGreeting(e.target.value)}
              placeholder={t("ai.greetingPlaceholder")}
              maxLength={200}
            />
          </div>
        ) : null}

        <p className="text-caption leading-5 text-content-subtle">{t("ai.privacyNote")}</p>

        {error ? <p className="text-caption font-medium text-red-600">{error}</p> : null}

        <TFButton type="submit" className="w-full" loading={saving} loadingLabel={t("common.saving")}>
          {editing ? t("common.save") : t("ai.create")}
        </TFButton>

        {editing && onDelete ? (
          <button
            type="button"
            onClick={onDelete}
            className="mx-auto flex items-center gap-1.5 text-caption font-medium text-red-600 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
          >
            <Trash2 size={14} aria-hidden="true" />
            {t("ai.delete")}
          </button>
        ) : null}
      </form>
    </div>
  );
}
