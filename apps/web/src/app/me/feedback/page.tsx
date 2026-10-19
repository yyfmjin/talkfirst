"use client";

import { useCallback, useEffect, useState } from "react";
import { Mail, MessageSquare, Send } from "lucide-react";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import {
  TFBadge,
  TFButton,
  TFCard,
  TFEmptyState,
  TFErrorState,
  TFField,
  TFTextarea,
  TFRowSkeleton,
  TFLoadingRegion,
} from "@/components/tf";
import { ApiRequestError, apiFetch } from "@/lib/api";
import { useT, type MsgKey } from "@/lib/i18n";

/**
 * 「意见反馈」 — send the team a message, and read any answer.
 *
 * ## Why the address is fetched rather than written into the page
 *
 * It is editable by an administrator at runtime, and a Next.js public environment
 * variable is fixed at build time — hard-coding it here would make the admin setting
 * useless. `GET /feedback` is the one call this screen makes before it can render, and it
 * returns the current address plus the length bound so the counter cannot drift from the
 * server's own limit.
 *
 * ## Why the member sees their own history
 *
 * A form that clears on submit and says only "已收到" leaves the member unsure whether
 * anything happened, and gives them no way to read the answer. Listing their own
 * submissions — with the reply inline — closes the loop without email.
 *
 * ## Why the contact address is optional
 *
 * The account already has an address, but a member may want the answer somewhere else, and
 * making the field mandatory would block someone who does not want to give one. Empty
 * means "no reply address", which is honest; the screen states that a reply may not reach
 * them instead of pretending otherwise.
 */

type SubmissionContext = { supportEmail: string; maxBody: number };

type FeedbackKind = "SUGGESTION" | "BUG" | "COMPLAINT" | "OTHER";

type MyFeedback = {
  id: string;
  kind: FeedbackKind;
  body: string;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
  replyBody: string | null;
  repliedAt: string | null;
  createdAt: string;
};

const KIND_OPTIONS: Array<{ value: FeedbackKind; labelKey: MsgKey }> = [
  { value: "SUGGESTION", labelKey: "fb.kindSuggestion" },
  { value: "BUG", labelKey: "fb.kindBug" },
  { value: "COMPLAINT", labelKey: "fb.kindComplaint" },
  { value: "OTHER", labelKey: "fb.kindOther" },
];

const STATUS_LABEL: Record<MyFeedback["status"], MsgKey> = {
  OPEN: "fb.statusOpen",
  IN_PROGRESS: "fb.statusInProgress",
  RESOLVED: "fb.statusResolved",
  CLOSED: "fb.statusClosed",
};

const STATUS_TONE: Record<MyFeedback["status"], "warning" | "neutral" | "success"> = {
  OPEN: "warning",
  IN_PROGRESS: "warning",
  RESOLVED: "success",
  CLOSED: "neutral",
};

export default function FeedbackPage() {
  const { t } = useT();
  const [context, setContext] = useState<SubmissionContext | null>(null);
  const [items, setItems] = useState<MyFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [kind, setKind] = useState<FeedbackKind>("SUGGESTION");
  const [body, setBody] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [sent, setSent] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [config, mine] = await Promise.all([
        apiFetch<SubmissionContext>("/feedback"),
        apiFetch<{ items: MyFeedback[] }>("/feedback/mine"),
      ]);
      setContext(config);
      setItems(mine.items);
    } catch (error) {
      setLoadError(friendlyError(error, t("fb.loadFailed")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFormError("");
    setSent(false);

    if (!body.trim()) {
      setFormError(t("fb.bodyRequired"));
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch("/feedback", {
        method: "POST",
        body: {
          kind,
          body: body.trim(),
          ...(contactEmail.trim() ? { contactEmail: contactEmail.trim() } : {}),
          source: "me/feedback",
        },
      });
      setBody("");
      setContactEmail("");
      setSent(true);
      await load();
    } catch (error) {
      setFormError(friendlyError(error, t("fb.submitFailed")));
    } finally {
      setSubmitting(false);
    }
  }

  const maxBody = context?.maxBody ?? 4000;

  return (
    <PhoneShell>
      <ScreenHeader title={t("fb.title")} backHref="/me" />

      <TFLoadingRegion label={t("fb.loading")}>
        {loading ? (
          /* Shapes rather than a spinner: the form has a known layout, so a skeleton
             keeps the page from jumping when the data arrives. */
          <div className="space-y-4 px-4 pb-8 pt-2">
            <TFRowSkeleton />
            <TFRowSkeleton />
            <TFRowSkeleton />
          </div>
        ) : loadError ? (
          <TFErrorState title={t("fb.loadFailedTitle")} description={loadError} onRetry={() => void load()} />
        ) : (
          <div className="space-y-4 px-4 pb-8 pt-2">
            {/* The address first, because a member who would rather write an e-mail than
                fill in a form should not have to scroll to find it. */}
            {context ? (
              <TFCard className="p-4">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-surface-sunken text-content-muted">
                    <Mail size={16} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-ui font-medium text-content">{t("fb.orEmail")}</p>
                    <a
                      data-testid="feedback-support-email"
                      href={`mailto:${context.supportEmail}`}
                      className="mt-0.5 block break-all text-ui text-brand-600 underline"
                    >
                      {context.supportEmail}
                    </a>
                  </div>
                </div>
              </TFCard>
            ) : null}

            <form onSubmit={submit} className="space-y-4" data-testid="feedback-form">
              <TFField label={t("fb.kindLabel")}>
                {() => (
                  <div className="flex flex-wrap gap-2">
                    {KIND_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        data-testid={`feedback-kind-${option.value}`}
                        onClick={() => setKind(option.value)}
                        aria-pressed={kind === option.value}
                        className={
                          kind === option.value
                            ? "rounded-full border border-brand-300 bg-brand-100 px-3 py-1.5 text-caption font-medium text-brand-700"
                            : "rounded-full border border-border px-3 py-1.5 text-caption text-content-muted transition-colors duration-instant hover:bg-surface-sunken"
                        }
                      >
                        {t(option.labelKey)}
                      </button>
                    ))}
                  </div>
                )}
              </TFField>

              <TFField
                label={t("fb.bodyLabel")}
                hint={t("fb.bodyHint")}
                error={formError || undefined}
                labelAction={
                  <span
                    className={
                      body.length > maxBody ? "text-caption text-danger-600" : "text-caption text-content-subtle"
                    }
                  >
                    {body.length}/{maxBody}
                  </span>
                }
              >
                {({ id, describedBy, invalid }) => (
                  <TFTextarea
                    id={id}
                    data-testid="feedback-body"
                    describedBy={describedBy}
                    invalid={invalid}
                    rows={6}
                    maxLength={maxBody}
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    placeholder={t("fb.bodyPlaceholder")}
                  />
                )}
              </TFField>

              <TFField
                label={t("fb.contactLabel")}
                hint={t("fb.contactHint")}
              >
                {({ id, describedBy, invalid }) => (
                  <input
                    id={id}
                    data-testid="feedback-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    aria-describedby={describedBy}
                    aria-invalid={invalid || undefined}
                    value={contactEmail}
                    onChange={(event) => setContactEmail(event.target.value)}
                    placeholder="you@example.com"
                    className="h-11 w-full rounded-control border border-border bg-surface px-3.5 text-ui"
                  />
                )}
              </TFField>

              <div className="flex items-center gap-3">
                <TFButton
                  type="submit"
                  variant="primary"
                  disabled={submitting || !body.trim() || body.length > maxBody}
                  leadingIcon={<Send size={16} />}
                >
                  {submitting ? t("fb.submitting") : t("fb.submit")}
                </TFButton>
                {sent ? (
                  <span data-testid="feedback-sent" className="text-caption text-success-600">
                    {t("fb.sent")}
                  </span>
                ) : null}
              </div>
            </form>

            <section className="pt-2">
              <h2 className="mb-2 text-caption font-medium text-content-muted">{t("fb.mine")}</h2>
              {items.length === 0 ? (
                <TFEmptyState
                  icon={<MessageSquare size={20} />}
                  title={t("fb.emptyTitle")}
                  description={t("fb.emptyDesc")}
                />
              ) : (
                <ul className="space-y-3" data-testid="feedback-list">
                  {items.map((item) => (
                    <li key={item.id}>
                      <TFCard className="p-4" data-testid={`feedback-item-${item.id}`}>
                        <div className="flex flex-wrap items-center gap-2">
                          <TFBadge tone={STATUS_TONE[item.status]}>
                            {t(STATUS_LABEL[item.status])}
                          </TFBadge>
                          <span className="text-overline text-content-subtle">
                            {new Date(item.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap break-words text-ui text-content">
                          {item.body}
                        </p>
                        {item.replyBody ? (
                          <div
                            data-testid={`feedback-reply-${item.id}`}
                            className="mt-3 rounded-control bg-surface-sunken p-3"
                          >
                            <p className="text-overline font-medium text-content-muted">{t("fb.officialReply")}</p>
                            <p className="mt-1 whitespace-pre-wrap break-words text-ui text-content">
                              {item.replyBody}
                            </p>
                          </div>
                        ) : null}
                      </TFCard>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </TFLoadingRegion>
    </PhoneShell>
  );
}

function friendlyError(error: unknown, fallback: string): string {
  if (!(error instanceof ApiRequestError)) return fallback;
  const message = error.message ?? "";
  if (!message || /prisma|stack|\bat \w|ECONNREFUSED|ETIMEDOUT|\bSQL\b|\b500\b/i.test(message)) {
    return fallback;
  }
  return message;
}
