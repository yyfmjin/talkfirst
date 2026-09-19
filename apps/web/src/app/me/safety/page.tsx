"use client";

import { useEffect, useState } from "react";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { GradientButton, OutlineButton } from "@/components/ui";
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
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-2">
        <div className="rounded-3xl bg-[#F7F9FF] p-4 text-[12px] leading-5 text-muted">
          TalkFirst 保护陌生人社交：高风险消息会被拦截并进入审核；拉黑后双方无法再发消息，未完成的请求会自动取消。
        </div>

        {loading ? (
          <div className="mt-5 animate-pulse space-y-3">
            <div className="h-24 rounded-3xl bg-indigo-50" />
            <div className="h-24 rounded-3xl bg-indigo-50" />
          </div>
        ) : null}

        {!loading ? (
          <>
            <section className="mt-6">
              <h2 className="text-[14px] font-semibold">已拉黑（{blocks.length}）</h2>
              {blocks.length === 0 ? (
                <p className="mt-2 text-[12px] text-muted">暂无拉黑用户。</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {blocks.map((item) => (
                    <div key={item.blockedId} className="flex items-center justify-between rounded-2xl border border-line p-3">
                      <div>
                        <p className="text-[13px] font-medium">{item.blocked.nickname ?? "用户"}</p>
                        <p className="text-[11px] text-muted">{item.blocked.countryCode ?? "全球"}</p>
                      </div>
                      <OutlineButton
                        className="h-10 w-24 text-[12px]"
                        onClick={() => void unblock(item.blockedId)}
                      >
                        {acting === item.blockedId ? "…" : "解除"}
                      </OutlineButton>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="mt-6">
              <h2 className="text-[14px] font-semibold">我的举报（{reports.length}）</h2>
              {reports.length === 0 ? (
                <p className="mt-2 text-[12px] text-muted">暂无举报记录。</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {reports.slice(0, 10).map((item) => (
                    <div key={item.id} className="rounded-2xl border border-line p-3">
                      <p className="text-[13px] font-medium">
                        {item.reportedUser.nickname ?? "用户"} · {item.reason}
                      </p>
                      <p className="mt-1 text-[11px] text-muted">
                        {item.status} · {new Date(item.createdAt).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : null}

        {error ? <p className="mt-4 text-[12px] text-red-500">{error}</p> : null}
        <GradientButton className="mt-6" href="/me/social">
          管理社交账号可见性
        </GradientButton>
      </div>
    </PhoneShell>
  );
}
