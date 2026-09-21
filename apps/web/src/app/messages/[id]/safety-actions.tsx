"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GradientButton, OutlineButton } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";
import { REPORT_REASONS, reportReasonLabel } from "@/lib/report-reasons";

export default function SafetyActions({ peerId, peerName }: { peerId: string | null; peerName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"menu" | "report" | "block">("menu");
  const [reason, setReason] = useState("Harassment");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  if (!peerId) return null;

  async function submitReport() {
    setBusy(true);
    setMessage("");
    try {
      await apiFetch("/reports", {
        method: "POST",
        body: { userId: peerId, reason, description: description.trim() || undefined },
      });
      setMessage("举报已提交，我们会尽快审核。");
      setMode("menu");
    } catch (requestError) {
      setMessage(requestError instanceof Error ? requestError.message : "举报失败");
    } finally {
      setBusy(false);
    }
  }

  async function confirmBlock() {
    setBusy(true);
    setMessage("");
    try {
      await apiFetch("/blocks", { method: "POST", body: { userId: peerId } });
      router.push("/messages");
    } catch (requestError) {
      setMessage(requestError instanceof Error ? requestError.message : "拉黑失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => {
          setOpen(true);
          setMode("menu");
          setMessage("");
        }}
        aria-label="聊天安全菜单"
        className="grid h-9 w-9 place-items-center rounded-full bg-[#F1F3FF] text-[16px]"
      >
        ⋯
      </button>

      {open ? (
        <div className="absolute inset-0 z-30 flex items-end justify-center bg-black/40" role="dialog" aria-modal="true">
          <div className="tf-scroll max-h-[85%] w-full overflow-y-auto rounded-t-[28px] bg-white p-6 pb-[calc(2rem+env(safe-area-inset-bottom))]">
            {mode === "menu" ? (
              <>
                <h2 className="text-[15px] font-semibold">聊天设置 · {peerName}</h2>
                <div className="mt-4 space-y-2">
                  <OutlineButton className="w-full" onClick={() => setMode("report")}>
                    举报用户
                  </OutlineButton>
                  <OutlineButton className="w-full" onClick={() => setMode("block")}>
                    拉黑
                  </OutlineButton>
                  <OutlineButton className="w-full" onClick={() => setOpen(false)}>
                    取消
                  </OutlineButton>
                </div>
                <p className="mt-3 text-[11px] leading-4 text-muted">
                  举报后进入人工审核；拉黑后双方无法再发消息，未完成的请求会自动取消。
                </p>
              </>
            ) : null}

            {mode === "report" ? (
              <>
                <h2 className="text-[15px] font-semibold">举报用户</h2>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {REPORT_REASONS.map((item) => (
                    <button
                      key={item}
                      onClick={() => setReason(item)}
                      className={cn(
                        "rounded-2xl border px-3 py-2 text-left text-[12px]",
                        reason === item ? "border-[#8B6CFF] bg-[#F4F1FF]" : "border-line",
                      )}
                    >
                      {reportReasonLabel(item)}
                    </button>
                  ))}
                </div>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={1000}
                  rows={3}
                  placeholder="补充说明（可选）"
                  className="mt-3 w-full rounded-2xl border border-line bg-[#F8FAFF] p-3 text-[13px] outline-none focus:ring-2 focus:ring-indigo-200"
                />
                <div className="mt-4 flex gap-2">
                  <OutlineButton className="w-1/3" onClick={() => setMode("menu")}>
                    返回
                  </OutlineButton>
                  <GradientButton className="w-2/3" onClick={() => void submitReport()} disabled={busy}>
                    {busy ? "提交中…" : "提交举报"}
                  </GradientButton>
                </div>
              </>
            ) : null}

            {mode === "block" ? (
              <>
                <h2 className="text-[15px] font-semibold">拉黑</h2>
                <p className="mt-2 text-[13px] leading-5 text-muted">
                  拉黑后你们将无法再互相发送消息。
                </p>
                <div className="mt-4 flex gap-2">
                  <OutlineButton className="w-1/3" onClick={() => setMode("menu")}>
                    返回
                  </OutlineButton>
                  <GradientButton className="w-2/3" onClick={() => void confirmBlock()} disabled={busy}>
                    {busy ? "处理中…" : "确认拉黑"}
                  </GradientButton>
                </div>
              </>
            ) : null}

            {message ? <p className="mt-3 text-[12px] text-muted">{message}</p> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
