"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { apiSend } from "@/lib/api";
import { AdminSessionProvider, useAdminSession } from "@/lib/session";
import { ROLE_LABELS, type Permission } from "@/lib/permissions";

/**
 * Phase A: navigation is filtered by permission.
 *
 * Hiding a link is a convenience only — the API rejects unauthorized calls
 * regardless. Only routes that actually exist are listed; later-phase modules
 * get added here as they ship.
 */
const NAV: Array<{ href: string; label: string; permission: Permission }> = [
  { href: "/dashboard", label: "仪表盘", permission: "dashboard:read" },
  { href: "/users", label: "用户", permission: "users:read" },
  { href: "/reports", label: "举报", permission: "reports:read" },
  // Phase B5: the moderation workbench. It reads the *same* report data through
  // the same endpoint, so its gate is `reports:read` — every role that can read
  // reports can open the workbench. It is deliberately NOT `moderation:read`:
  // that permission belongs to a future standalone moderation domain and is held
  // by only three roles, so gating here would take Reports access away from
  // SUPPORT and ANALYST, who have it today.
  { href: "/moderation", label: "审核工作台", permission: "reports:read" },
  // Phase C1: the risk centre. Gated on `risk:read`, which is held by
  // SUPER_ADMIN, MODERATOR and ANALYST — note this is a *different* set from
  // both `reports:read` (all five) and `moderation:read` (three, but with
  // CONTENT_MANAGER instead of ANALYST). The API enforces the same permission,
  // so hiding the link is convenience, never the boundary.
  { href: "/risk", label: "风险中心", permission: "risk:read" },
  // Phase C2: the connections screen. Gated on `connections:read`, which is
  // held by SUPER_ADMIN and ANALYST only — a narrower set than `risk:read`
  // (which adds MODERATOR). The API enforces the same permission, so hiding
  // the link is convenience, never the boundary.
  { href: "/connections", label: "连接", permission: "connections:read" },
  // Phase C3: the contact-exchange screen. Gated on `exchanges:read`, which is
  // held by SUPER_ADMIN and ANALYST only — the same holder set as
  // `connections:read`. The API enforces the same permission, so hiding the
  // link is convenience, never the boundary.
  { href: "/exchanges", label: "交换", permission: "exchanges:read" },
  // Phase C4: the block-relationship screen. Gated on `blocks:read`, which is
  // held by SUPER_ADMIN and ANALYST only — the same holder set as
  // `connections:read` and `exchanges:read`. The API enforces the same
  // permission, so hiding the link is convenience, never the boundary.
  { href: "/blocks", label: "屏蔽", permission: "blocks:read" },
  { href: "/audit", label: "审计日志", permission: "audit:read" },
];

function ShellChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { identity, loading, error, can } = useAdminSession();

  async function logout() {
    await apiSend("/auth/logout", "POST").catch(() => undefined);
    router.replace("/login");
  }

  const visible = NAV.filter((item) => can(item.permission));

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl gap-4 p-4">
      <aside className="w-56 shrink-0 rounded-2xl bg-[#16213A] p-4 text-white">
        <p className="text-[18px] font-semibold">TalkFirst</p>
        <p className="text-[12px] text-white/60">Admin Console · 3001</p>

        {identity ? (
          <div className="mt-4 rounded-xl bg-white/10 p-3">
            <p className="truncate text-[12px] font-medium">
              {identity.user.nickname ?? identity.user.email}
            </p>
            <p className="mt-1 inline-flex rounded-full bg-white/15 px-2 py-0.5 text-[10px] tracking-wide text-white/90">
              {identity.role}
            </p>
            <p className="mt-1 text-[10px] text-white/50">{ROLE_LABELS[identity.role]}</p>
          </div>
        ) : null}

        <nav className="mt-5 space-y-1">
          {visible.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-xl px-3 py-2.5 text-[13px] ${
                pathname === item.href ? "bg-white/15 font-medium" : "text-white/70 hover:bg-white/10"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <button
          onClick={() => void logout()}
          className="mt-8 w-full rounded-xl bg-white/10 px-3 py-2 text-[13px] hover:bg-white/20"
        >
          退出登录
        </button>
        <p className="mt-6 text-[11px] leading-4 text-white/50">
          权限由后端强制校验。所有封禁 / 解封 / 审核都会写入审计日志（含原因、IP、变更前后）。
        </p>
      </aside>
      <main className="min-w-0 flex-1 rounded-2xl bg-white p-6 shadow-sm">
        {loading ? <p className="text-[13px] text-muted">加载中…</p> : null}
        {!loading && error ? <p className="text-[13px] text-red-500">{error}</p> : null}
        {!loading && !error ? children : null}
      </main>
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <AdminSessionProvider>
      <ShellChrome>{children}</ShellChrome>
    </AdminSessionProvider>
  );
}
