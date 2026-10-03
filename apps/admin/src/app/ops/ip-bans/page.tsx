"use client";

import { useCallback, useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Shell } from "@/components/shell";
import { ApiRequestError, apiFetch, apiSend } from "@/lib/api";
import { useAdminSession } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";

/**
 * IP 封禁 — blocking and unblocking client addresses.
 *
 * ## The two levels, and why an operator has to choose one
 *
 * `SECONDARY` refuses everything EXCEPT sign-in, sign-up, verification, recovery and
 * logout, so the person can still reach the app, understand their state and appeal.
 * `PRIMARY` refuses every request. The distinction is not cosmetic: a SECONDARY ban is
 * the right default for "this account is abusive", and PRIMARY is for traffic with no
 * legitimate use of the API at all. Choosing the wrong one either under-blocks or turns
 * a moderation action into a silent lockout, so the form states both meanings rather
 * than showing a bare enum.
 *
 * ## Why the API may refuse an address, and why that is shown verbatim
 *
 * `POST /admin/ip-bans` rejects loopback and private ranges, and rejects any address
 * already recorded on an admin request. Those refusals exist because a PRIMARY ban on
 * such an address ends the operator's own access, and console-driven recovery is then
 * impossible. The API's message explains the reason, so this screen surfaces it
 * unchanged — a generic "保存失败" would hide the one piece of information that tells
 * the operator what to do instead.
 *
 * ## Read and write are different permissions
 *
 * The nav link is gated on `ops:write`, but the page still checks before offering the
 * form: `ops:read` alone (ANALYST) may reach `/ops/access-logs` and from there a detail
 * page, and this route must not render an action the API will refuse.
 */

type BanLevel = "SECONDARY" | "PRIMARY";

type IpBan = {
  id: string;
  ip: string;
  level: BanLevel;
  reason: string;
  expiresAt: string | null;
  createdAt: string;
  liftedAt: string | null;
  createdById: string | null;
  liftedById: string | null;
  createdByLabel: string | null;
  liftedByLabel: string | null;
};

type ListResponse = {
  items: IpBan[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const LEVEL_LABEL: Record<BanLevel, string> = {
  SECONDARY: "二级（仅保留登录）",
  PRIMARY: "一级（拒绝全部请求）",
};

const LEVEL_HINT: Record<BanLevel, string> = {
  SECONDARY: "该地址仍可登录、注册、验证与找回密码，其余请求全部拒绝。",
  PRIMARY: "该地址的所有请求都被拒绝，包括登录。",
};

export default function IpBansPage() {
  /**
   * `useSearchParams` needs a Suspense boundary in the App Router, because it reads
   * request-time data and would otherwise opt the whole route out of static rendering.
   * The fallback mirrors the screen's own loading state so the transition is invisible.
   */
  return (
    <Shell>
      <Suspense fallback={<p className="mt-6 text-[13px] text-muted">加载中…</p>}>
        <IpBansScreen />
      </Suspense>
    </Shell>
  );
}

function IpBansScreen() {
  const { identity } = useAdminSession();
  const canWrite = Boolean(identity && hasPermission(identity.role, "ops:write"));
  const searchParams = useSearchParams();

  const [items, setItems] = useState<IpBan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [ip, setIp] = useState("");
  const [level, setLevel] = useState<BanLevel>("SECONDARY");
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  /**
   * Prefill from `?ip=`, which is how the access-log detail screen hands an address over.
   *
   * Seeded once and never re-applied: a later re-render must not overwrite what the
   * operator has started typing, which is what an effect keyed on the query would do.
   */
  const prefillIp = searchParams?.get("ip") ?? "";
  useEffect(() => {
    if (prefillIp) setIp(prefillIp);
  }, [prefillIp]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<ListResponse>("/admin/ip-bans");
      setItems(data.items);
    } catch (requestError) {
      setError(friendlyError(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Not awaited at the call site: the screen renders its loading state and this
    // resolves into it.
    void load();
  }, [load]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFormError("");
    setNotice("");
    setSaving(true);
    try {
      await apiSend("/admin/ip-bans", "POST", {
        ip: ip.trim(),
        level,
        reason: reason.trim(),
        // Omitted rather than sent as "" so the DTO's optional ISO check is not handed
        // an empty string, which is not a valid date.
        ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
      });
      setNotice(`已封禁 ${ip.trim()}`);
      setIp("");
      setReason("");
      setExpiresAt("");
      await load();
    } catch (requestError) {
      /**
       * `friendlyError` deliberately does NOT generalise here: the API's refusal codes
       * (IP_BAN_REFUSED_LOCAL / IP_BAN_REFUSED_ADMIN_IP) carry a message that explains
       * what to do instead, and replacing it with "保存失败" would remove the only
       * actionable part.
       */
      setFormError(friendlyError(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function lift(ban: IpBan) {
    setError("");
    setNotice("");
    try {
      await apiSend(`/admin/ip-bans/${ban.id}/lift`, "POST", {});
      setNotice(`已解封 ${ban.ip}`);
      await load();
    } catch (requestError) {
      setError(friendlyError(requestError));
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-[20px] font-semibold">IP 封禁</h1>
      <p className="mt-1 text-[13px] text-muted">
        被拒绝的请求仍会记入访问日志，可在
        <Link href="/ops/access-logs" className="mx-1 text-blue-600 underline">
          访问日志
        </Link>
        中核对封禁是否生效，以及是否误伤。
      </p>

      {canWrite ? (
        <form
          onSubmit={submit}
          data-testid="ip-ban-form"
          className="mt-5 rounded-2xl border border-line bg-card p-4 shadow-card"
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <label className="block">
              <span className="text-[12px] text-muted">IP 地址</span>
              <input
                data-testid="ip-ban-ip"
                value={ip}
                onChange={(event) => setIp(event.target.value)}
                placeholder="203.0.113.5"
                className="mt-1 h-10 w-full rounded-xl border border-line px-3 font-mono text-[13px] outline-none"
              />
            </label>

            <label className="block">
              <span className="text-[12px] text-muted">封禁层级</span>
              <select
                data-testid="ip-ban-level"
                value={level}
                onChange={(event) => setLevel(event.target.value as BanLevel)}
                className="mt-1 h-10 w-full rounded-xl border border-line px-3 text-[13px] outline-none"
              >
                <option value="SECONDARY">{LEVEL_LABEL.SECONDARY}</option>
                <option value="PRIMARY">{LEVEL_LABEL.PRIMARY}</option>
              </select>
            </label>

            <label className="block">
              <span className="text-[12px] text-muted">原因（必填）</span>
              <input
                data-testid="ip-ban-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="mt-1 h-10 w-full rounded-xl border border-line px-3 text-[13px] outline-none"
              />
            </label>

            <label className="block">
              <span className="text-[12px] text-muted">到期时间（可选）</span>
              <input
                data-testid="ip-ban-expires"
                type="datetime-local"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
                className="mt-1 h-10 w-full rounded-xl border border-line px-3 text-[13px] outline-none"
              />
            </label>
          </div>

          {/* The chosen level's meaning is stated in full, because the enum names alone
              do not tell an operator what a member will still be able to do. */}
          <p data-testid="ip-ban-level-hint" className="mt-3 text-[12px] text-muted">
            {LEVEL_HINT[level]}
          </p>

          <div className="mt-3 flex items-center gap-3">
            <button
              type="submit"
              data-testid="ip-ban-submit"
              disabled={saving || !ip.trim() || !reason.trim()}
              className="h-10 rounded-xl bg-primary-ink px-4 text-[13px] font-medium text-white disabled:opacity-50"
            >
              封禁
            </button>
            {formError ? (
              <span data-testid="ip-ban-form-error" className="text-[13px] text-red-500">
                {formError}
              </span>
            ) : null}
          </div>
        </form>
      ) : (
        <p data-testid="ip-ban-readonly" className="mt-5 text-[13px] text-muted">
          你的角色没有封禁权限，只能查看。
        </p>
      )}

      {notice ? (
        <p data-testid="ip-ban-notice" className="mt-3 text-[13px] text-success-ink">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p data-testid="ip-ban-error" className="mt-3 text-[13px] text-red-500">
          {error}
        </p>
      ) : null}

      <div className="mt-5">
        {loading ? (
          <p data-testid="ip-bans-loading" className="mt-6 text-[13px] text-muted">
            加载中…
          </p>
        ) : items.length === 0 ? (
          <p data-testid="ip-bans-empty" className="mt-6 text-[13px] text-muted">
            当前没有生效中的 IP 封禁。
          </p>
        ) : (
          <table data-testid="ip-bans-table" className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[12px] text-muted">
                <th className="pb-2 pr-4 font-normal">IP</th>
                <th className="pb-2 pr-4 font-normal">层级</th>
                <th className="pb-2 pr-4 font-normal">原因</th>
                <th className="pb-2 pr-4 font-normal">到期</th>
                <th className="pb-2 pr-4 font-normal">操作人</th>
                <th className="pb-2 font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((ban) => (
                <tr key={ban.id} data-testid={`ip-ban-row-${ban.id}`} className="border-b border-line/60">
                  <td className="py-2 pr-4 font-mono text-[12px]">{ban.ip}</td>
                  <td className="py-2 pr-4">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        ban.level === "PRIMARY"
                          ? "bg-danger-wash text-danger-ink"
                          : "bg-warning-wash text-warning-ink"
                      }`}
                    >
                      {ban.level === "PRIMARY" ? "一级" : "二级"}
                    </span>
                  </td>
                  <td className="py-2 pr-4">{ban.reason}</td>
                  <td className="py-2 pr-4 text-muted">
                    {ban.expiresAt ? new Date(ban.expiresAt).toLocaleString() : "永久"}
                  </td>
                  <td className="py-2 pr-4 text-muted">
                    {ban.createdByLabel ?? "—"}
                    <span className="ml-1 text-[11px]">
                      {new Date(ban.createdAt).toLocaleDateString()}
                    </span>
                  </td>
                  <td className="py-2">
                    {canWrite ? (
                      <button
                        type="button"
                        data-testid={`ip-ban-lift-${ban.id}`}
                        onClick={() => void lift(ban)}
                        className="text-[12px] text-blue-600 underline"
                      >
                        解封
                      </button>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function friendlyError(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return "操作失败，请稍后重试";
  const message = error.message ?? "";
  // An unexpected provider/driver message could name internals; a known domain message
  // is shown as-is because several of them are the only actionable part of the reply.
  if (!message || /prisma|stack|\bat \w|ECONNREFUSED|ETIMEDOUT|\bSQL\b|\b500\b/i.test(message)) {
    return "操作失败，请稍后重试";
  }
  return message;
}
