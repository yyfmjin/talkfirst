"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { AuditTimeline, TimelineSummary, type AuditTimelineItem } from "@/components/audit-timeline";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api";

/**
 * The audit log, as an activity feed.
 *
 * Every row is a real `AdminAuditLog` entry: who acted, on what, and when. The
 * screen is read-only, so it writes no audit entry of its own.
 *
 * `actorType` is optional because an older API build may not send it; the
 * timeline treats an absent value as a human row, which is what it has always
 * been for rows written before SYSTEM actors existed.
 */

type Page<T> = { items: T[]; total: number; page: number; pageSize: number };

export default function AuditPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Page<AuditTimelineItem> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(
    async (nextPage = page) => {
      setLoading(true);
      setError("");
      try {
        const data = await apiFetch<Page<AuditTimelineItem>>(
          `/admin/audit?page=${nextPage}&pageSize=20`,
        );
        setResult(data);
        setPage(data.page);
      } catch (requestError) {
        const message = requestError instanceof Error ? requestError.message : "加载失败";
        if (
          message.includes("ADMIN_REQUIRED") ||
          message.includes("ADMIN_INACTIVE") ||
          message.includes("401")
        ) {
          router.replace("/login");
          return;
        }
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [page, router],
  );

  useEffect(() => {
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <Shell>
      <PageHeader
        title="审计日志"
        description="谁在何时封了谁、审了哪条举报，全部可追溯。"
        actions={
          <button
            type="button"
            onClick={() => void load(page)}
            disabled={loading}
            className="tf-btn"
          >
            {loading ? "刷新中…" : "刷新"}
          </button>
        }
      />

      {error ? (
        <ErrorState message={error} onRetry={() => void load(page)} retrying={loading} className="mt-4" />
      ) : null}

      {result ? (
        <TimelineSummary>
          共 {result.total} 条 · 第 {result.page} / {totalPages} 页
        </TimelineSummary>
      ) : null}

      {result && result.items.length === 0 ? (
        <EmptyState className="mt-4" description="当前没有任何管理员操作记录。" />
      ) : null}

      {result && result.items.length > 0 ? <AuditTimeline items={result.items} /> : null}

      {result && totalPages > 1 ? (
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => void load(page - 1)}
            className="tf-btn"
          >
            上一页
          </button>
          <button
            type="button"
            disabled={page >= totalPages || loading}
            onClick={() => void load(page + 1)}
            className="tf-btn"
          >
            下一页
          </button>
        </div>
      ) : null}
    </Shell>
  );
}
