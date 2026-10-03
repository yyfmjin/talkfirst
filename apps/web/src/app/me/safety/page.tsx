"use client";

import { useEffect, useState } from "react";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { TFButton, TFLoadingRegion, TFSkeleton } from "@/components/tf";
import { apiFetch } from "@/lib/api";

type BlockItem = {
  blockedId: string;
  blocked: { id: string; nickname: string | null; avatarUrl: string | null; countryCode: string | null };
  createdAt: string;
};

type ReportItem = {
  id: string;
  reason: string;
  status: string;
  createdAt: string;
  reportedUser: { id: string; nickname: string | null };
};

export default function SafetyPage() {
  const [blocks, setBlocks] = useState<BlockItem[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [acting, setActing] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [blockList, reportList] = await Promise.all([
          apiFetch<BlockItem[]>("/blocks"),
          apiFetch<ReportItem[]>("/reports/mine"),
        ]);
        setBlocks(blockList);
        setReports(reportList);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "加载失败");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  async function unblock(userId: string) {
    setActing(userId);
    try {
      await apiFetch(`/blocks/${userId}`, { method: "DELETE" });
      setBlocks((current) => current.filter((item) => item.blockedId !== userId));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "解除失败");
    } finally {
      setActing(null);
    }
  }

  return (
    <PhoneShell>
      <ScreenHeader title="安全中心" backHref="/me" />
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-2">
        <p className="rounded-card bg-surface-sunken p-4 text-caption leading-5 text-content-muted">
          TalkFirst 保护陌生人社交：高风险消息会被拦截并进入审核；拉黑后双方无法再发消息，未完成的请求会自动取消。
        </p>

        {loading ? (
          <TFLoadingRegion label="正在加载安全中心">
            <div className="mt-5 space-y-3">
              <TFSkeleton shape="block" className="h-24 w-full" />
              <TFSkeleton shape="block" className="h-24 w-full" />
            </div>
          </TFLoadingRegion>
        ) : null}

        {!loading ? (
          <>
            <section className="mt-6">
              <h2 className="text-ui font-semibold text-content">已拉黑（{blocks.length}）</h2>
              {blocks.length === 0 ? (
                <p className="mt-2 text-caption text-content-muted">暂无拉黑用户。</p>
              ) : (
                <div className="mt-3 divide-y divide-border overflow-hidden rounded-card border border-border">
                  {blocks.map((item) => (
                    <div key={item.blockedId} className="flex items-center justify-between gap-3 bg-surface px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-ui font-medium text-content">
                          {item.blocked.nickname ?? "用户"}
                        </p>
                        <p className="text-caption text-content-muted">{item.blocked.countryCode ?? "全球"}</p>
                      </div>
                      <TFButton
                        variant="secondary"
                        size="sm"
                        className="shrink-0"
                        onClick={() => void unblock(item.blockedId)}
                        loading={acting === item.blockedId}
                        loadingLabel="…"
                        /* The accessible name says WHO is being unblocked — a row of
                           bare 「解除」 buttons is unusable with a screen reader. */
                        aria-label={`解除对 ${item.blocked.nickname ?? "该用户"} 的拉黑`}
                      >
                        解除
                      </TFButton>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="mt-6">
              <h2 className="text-ui font-semibold text-content">我的举报（{reports.length}）</h2>
              {reports.length === 0 ? (
                <p className="mt-2 text-caption text-content-muted">暂无举报记录。</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {reports.slice(0, 10).map((item) => (
                    <div key={item.id} className="rounded-card border border-border bg-surface p-3.5">
                      <p className="break-words text-ui font-medium text-content">
                        {item.reportedUser.nickname ?? "用户"} · {item.reason}
                      </p>
                      <p className="mt-1 text-caption text-content-muted">
                        {/* The status enum used to be printed raw — an upstream value
                            like `PENDING` shown verbatim to a member. Mapped to
                            wording, with the raw value as the fallback so a new
                            backend state degrades to "shows something" rather than
                            to a blank. */}
                        {REPORT_STATUS_LABELS[item.status] ?? item.status} ·{" "}
                        {new Date(item.createdAt).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : null}

        {error ? (
          <p role="alert" className="mt-4 break-words text-caption text-danger-600">
            {error}
          </p>
        ) : null}

        <TFButton variant="secondary" fullWidth className="mt-6" href="/me/social">
          管理社交账号可见性
        </TFButton>
      </div>
    </PhoneShell>
  );
}

/**
 * Report status wording. The page printed the raw enum, so a member saw
 * `PENDING` / `REVIEWED`. `?? item.status` keeps that behaviour as the fallback
 * for any state added later, which is better than rendering nothing.
 */
const REPORT_STATUS_LABELS: Record<string, string> = {
  PENDING: "待审核",
  REVIEWED: "已审核",
  RESOLVED: "已处理",
  DISMISSED: "已驳回",
  ACTION_TAKEN: "已处理",
};
