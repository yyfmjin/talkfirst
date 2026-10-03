"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { DetailSection } from "@/components/detail-section";
import { ApiRequestError, apiFetch } from "@/lib/api";

/**
 * Phase C4 — the Block detail screen.
 *
 * ## What this page is
 *
 * A single `Block` relationship, read from
 * `GET /admin/blocks/:blockerId/:blockedId`: who blocked whom, and when. That
 * is the whole of a block row — the schema has three columns and no more.
 *
 * ## The URL is the composite key, not an id
 *
 * `Block` declares `@@id([blockerId, blockedId])` and has no `id` column, so
 * there is no single value that identifies a row. The route therefore carries
 * the pair, and this page reads **both** segments. A `/blocks/:id` route would
 * have had to invent an identifier the database cannot resolve back.
 *
 * ## Direction is rendered explicitly, never implied
 *
 * `Alice → Bob` and `Bob → Alice` are different facts. The screen shows
 * 「屏蔽方 Alice」 → 「屏蔽」 → 「被屏蔽方 Bob」 rather than a neutral
 * 「关联用户」 pair, and it renders the pair exactly as the API returned it —
 * no sorting of the two ids, no canonicalising, no swapping. Getting this
 * backwards in a moderation console is the difference between "Alice is being
 * harassed" and "Alice is harassing someone".
 *
 * ## What it deliberately does NOT show
 *
 * No `email`, no `handle`, no `passwordHash`, no token, no IP, no user-agent.
 * A block is not a chat and not a social-account audit: this screen does not
 * load a `Conversation`, a `Message`, a `SharedSocialAccount` or a
 * `SocialAccount`, and the API behind it does not return any of them. The
 * absence is asserted in the browser tests as well.
 *
 * ## The handling history is honestly empty
 *
 * A `Block` has no dedicated audit table, and none was added. The API queries
 * `AdminAuditLog` for `targetType = "BLOCK"` and reports whatever it finds —
 * today, nothing — so this screen renders 「暂无处理记录」 rather than a
 * fabricated timeline.
 */

type Party = { id: string; nickname: string | null };

type HistoryItem = {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  actorType: "USER" | "SYSTEM";
  adminId: string | null;
  reason: string | null;
  detail: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
};

type BlockDetailResponse = {
  block: { blockerId: string; blockedId: string; createdAt: string };
  blocker: Party;
  blocked: Party;
  history: HistoryItem[];
};

export default function BlockDetailPage() {
  return (
    <Shell>
      <BlockDetailScreen />
    </Shell>
  );
}

function BlockDetailScreen() {
  const router = useRouter();
  const params = useParams<{ blockerId: string; blockedId: string }>();
  const blockerId = params.blockerId;
  const blockedId = params.blockedId;

  const [data, setData] = useState<BlockDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch<BlockDetailResponse>(
        `/admin/blocks/${blockerId}/${blockedId}`,
      );
      setData(response);
    } catch (requestError) {
      const code = (requestError as { code?: string }).code;
      if (code === "ADMIN_REQUIRED" || code === "ADMIN_INACTIVE" || code === "UNAUTHORIZED") {
        router.replace("/login");
        return;
      }
      setError(friendlyError(requestError));
    } finally {
      setLoading(false);
    }
  }, [blockerId, blockedId, router]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockerId, blockedId]);

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-semibold">屏蔽关系</h1>
          <p className="mt-1 text-[13px] text-muted">
            一条有方向的屏蔽关系。此页面只读，不产生审计记录。
          </p>
        </div>
        <Link
          href="/blocks"
          className="tf-btn"
        >
          返回列表
        </Link>
      </div>

      {loading ? (
        <p data-testid="block-detail-loading" className="mt-6 text-[13px] text-muted">
          加载中…
        </p>
      ) : null}

      {!loading && error ? (
        <div data-testid="block-detail-error" className="mt-4 rounded-2xl border border-line bg-card shadow-card p-4">
          <p className="text-[13px] text-red-500">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 tf-btn"
          >
            重试
          </button>
        </div>
      ) : null}

      {!loading && !error && data ? (
        <>
          <Section title="屏蔽关系信息">
            <Field label="屏蔽方 ID" value={<code className="font-mono text-[12px]">{data.block.blockerId}</code>} />
            <Field label="被屏蔽方 ID" value={<code className="font-mono text-[12px]">{data.block.blockedId}</code>} />
            <Field
              label="创建时间"
              value={
                <span data-testid="block-detail-created">
                  {new Date(data.block.createdAt).toLocaleString()}
                </span>
              }
            />
          </Section>

          {/*
            The direction is drawn as a vertical chain rather than a two-column
            table so there is no reading order that could suggest the pair is
            unordered. Both labels name the role, and the arrow carries the verb.
          */}
          <Section title="方向">
            <div className="flex flex-col items-start gap-1">
              <span className="text-[11px] text-muted">屏蔽方</span>
              <Link
                href={`/users/${data.blocker.id}`}
                data-testid="block-detail-blocker"
                className="text-[14px] font-medium text-blue-600 underline"
              >
                {data.blocker.nickname ?? data.blocker.id.slice(0, 8)}
              </Link>
              <span
                data-testid="block-detail-direction"
                className="my-1 rounded-full bg-danger-wash px-2 py-0.5 text-[11px] font-medium text-danger-ink"
              >
                屏蔽 ↓
              </span>
              <span className="text-[11px] text-muted">被屏蔽方</span>
              <Link
                href={`/users/${data.blocked.id}`}
                data-testid="block-detail-blocked"
                className="text-[14px] font-medium text-blue-600 underline"
              >
                {data.blocked.nickname ?? data.blocked.id.slice(0, 8)}
              </Link>
            </div>
          </Section>

          <Section title="屏蔽方">
            <Field label="用户 ID" value={<code className="font-mono text-[12px]">{data.blocker.id}</code>} />
            <Field label="昵称" value={data.blocker.nickname ?? "（未设置）"} />
          </Section>

          <Section title="被屏蔽方">
            <Field label="用户 ID" value={<code className="font-mono text-[12px]">{data.blocked.id}</code>} />
            <Field label="昵称" value={data.blocked.nickname ?? "（未设置）"} />
          </Section>

          <Section title="处理历史">
            {data.history.length === 0 ? (
              <p data-testid="block-history-empty" className="text-[13px] text-muted">
                暂无处理记录
              </p>
            ) : (
              <ul data-testid="block-history" className="space-y-2 text-[13px]">
                {data.history.map((item) => (
                  <li key={item.id} className="rounded-xl border border-line bg-surface p-3">
                    <p className="font-medium">{item.action}</p>
                    <p className="mt-1 text-[12px] text-muted">
                      {item.actorType} · {new Date(item.createdAt).toLocaleString()}
                    </p>
                    {item.reason ? <p className="mt-1 text-[12px]">原因：{item.reason}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      ) : null}
    </>
  );
}

/** A titled block on this screen — the console-wide detail section. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <DetailSection title={title} className="mt-6">
      {children}
    </DetailSection>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 py-1">
      <span className="w-28 shrink-0 text-[12px] text-muted">{label}</span>
      <span className="min-w-0 break-all text-[13px]">{value}</span>
    </div>
  );
}

/**
 * Never surface a database error, a stack trace or a connection string. The
 * guard is a denylist rather than an allowlist: a message that mentions Prisma
 * or SQL is replaced outright, and anything else the API wrote in its envelope
 * is already a human-readable sentence.
 */
function friendlyError(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return "加载失败，请稍后重试";
  const code = error.code;
  if (code === "PERMISSION_DENIED") return "无权限访问";
  if (code === "BLOCK_NOT_FOUND") return "屏蔽记录不存在";
  if (code === "VALIDATION_ERROR") return "请求参数不合法";
  const message = error.message ?? "";
  if (!message || /prisma|stack|\bat \w|ECONNREFUSED|ETIMEDOUT|\bSQL\b|\b500\b/i.test(message)) {
    return "加载失败，请稍后重试";
  }
  return message;
}
