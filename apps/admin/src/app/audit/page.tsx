"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { apiFetch } from "@/lib/api";

type AuditItem = {
  id: string;
  /**
   * Who performed the action. `SYSTEM` means the platform itself — a scheduler
   * tick or background job — and such a row always has `adminId === null`.
   * Typed as optional because an older API build may not send it yet; the
   * render path below stays safe either way.
   */
  actorType?: "USER" | "SYSTEM";
  /** `null` for SYSTEM rows: there is deliberately no administrator to name. */
  adminId: string | null;
  action: string;
  targetId: string | null;
  detail: string | null;
  createdAt: string;
};

type Page<T> = { items: T[]; total: number; page: number; pageSize: number };

export default function AuditPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Page<AuditItem> | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(
    async (nextPage = page) => {
      try {
        const data = await apiFetch<Page<AuditItem>>(`/admin/audit?page=${nextPage}&pageSize=20`);
        setResult(data);
        setPage(data.page);
      } catch (requestError) {
        const message = requestError instanceof Error ? requestError.message : "加载失败";
        if (message.includes("ADMIN_REQUIRED") || message.includes("ADMIN_INACTIVE") || message.includes("401")) {
          router.replace("/login");
          return;
        }
        setError(message);
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
      <h1 className="text-[20px] font-semibold">审计日志</h1>
      <p className="mt-1 text-[13px] text-muted">谁在何时封了谁、审了哪条举报，全部可追溯。</p>
      {error ? <p className="mt-3 text-[13px] text-red-500">{error}</p> : null}
      {result ? (
        <p className="mt-2 text-[12px] text-muted">
          共 {result.total} 条 · 第 {result.page} / {totalPages} 页
        </p>
      ) : null}
      <div className="mt-3 space-y-2">
        {result?.items.map((item) => {
          // A machine action has no administrator behind it, so the actor column
          // must never be rendered from `adminId`. Only the SYSTEM branch is
          // allowed to describe the actor without an id, and only the USER
          // branch reads `adminId` at all.
          const isSystem = item.actorType === "SYSTEM";
          return (
            <div key={item.id} className="rounded-2xl border border-line p-3 text-[12px]">
              <p className="font-medium">{item.action}</p>
              <p className="mt-1 text-muted">
                {new Date(item.createdAt).toLocaleString()} ·{" "}
                {isSystem ? (
                  <span
                    className="rounded-full bg-[#E4EAF7] px-2 py-0.5 text-[11px] font-medium text-[#4A5A7A]"
                    title="平台自动执行，没有人工操作者"
                  >
                    系统 · 自动
                  </span>
                ) : (
                  // Defensive `?.`: `adminId` is nullable at the type level, and a
                  // USER row should always have one — but a rendering crash is
                  // not an acceptable way to discover a bad row.
                  `admin ${item.adminId?.slice(0, 8) ?? "-"}`
                )}{" "}
                · target {item.targetId ? item.targetId.slice(0, 8) : "-"}
              </p>
              {item.detail ? <p className="mt-1">{item.detail}</p> : null}
            </div>
          );
        })}
      </div>
      {result && totalPages > 1 ? (
        <div className="mt-4 flex gap-2">
          <button
            disabled={page <= 1}
            onClick={() => void load(page - 1)}
            className="h-9 rounded-xl border border-line px-4 text-[13px] disabled:opacity-40"
          >
            上一页
          </button>
          <button
            disabled={page >= totalPages}
            onClick={() => void load(page + 1)}
            className="h-9 rounded-xl border border-line px-4 text-[13px] disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      ) : null}
    </Shell>
  );
}
