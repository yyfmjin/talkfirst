"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiSend } from "@/lib/api";
import { AdminSessionProvider, useAdminSession } from "@/lib/session";
import { ROLE_LABELS, type Permission } from "@/lib/permissions";

/**
 * The console chrome: AdminShell → AdminSidebar + AdminHeader + content column.
 *
 * ## Permission gating is unchanged
 *
 * Each entry below carries the *same* `permission` it always has. The gate on
 * 「审核工作台」 is deliberately `reports:read`, not `moderation:read` — that is
 * the whole reason every report-reading role can open the workbench. 「风险中心」
 * is `risk:read`; the three relationship screens are their own read permissions.
 * None of that is touched here: this file changes *where the links sit*, never
 * *who sees them*. Hiding a link remains a convenience — the API is the boundary.
 *
 * ## Why the groups are ordered the way they are
 *
 * The console reads top-to-bottom as a workflow: what is happening (总览), who
 * the users are and how they relate (用户与关系), what needs adjudicating
 * (内容治理), and what to verify afterwards (风险与审计). Grouping is a product
 * decision made in this phase, so the four browser suites that pin the nav order
 * were updated in the same change — and they still assert strict equality over
 * the *whole* list, which is what keeps an unreviewed route failing there.
 */

type NavItem = { href: string; label: string; permission: Permission };

/** Sidebar sections, in render order. A section with nothing visible is dropped. */
const NAV_GROUPS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "总览",
    items: [{ href: "/dashboard", label: "仪表盘", permission: "dashboard:read" }],
  },
  {
    title: "用户与关系",
    items: [
      { href: "/users", label: "用户", permission: "users:read" },
      // Phase C2: `connections:read` — held by SUPER_ADMIN and ANALYST only.
      { href: "/connections", label: "连接", permission: "connections:read" },
      // Phase C3: `exchanges:read` — the same holder set as `connections:read`.
      { href: "/exchanges", label: "交换", permission: "exchanges:read" },
      // Phase C4: `blocks:read` — again the same holder set.
      { href: "/blocks", label: "屏蔽", permission: "blocks:read" },
    ],
  },
  {
    title: "内容治理",
    items: [
      { href: "/reports", label: "举报", permission: "reports:read" },
      // Phase B5: reads the same report data through the same endpoint, so it is
      // gated on `reports:read` rather than `moderation:read`.
      { href: "/moderation", label: "审核工作台", permission: "reports:read" },
    ],
  },
  {
    title: "风险与审计",
    items: [
      // Phase C1: `risk:read` — SUPER_ADMIN, MODERATOR and ANALYST.
      { href: "/risk", label: "风险中心", permission: "risk:read" },
      { href: "/audit", label: "审计日志", permission: "audit:read" },
    ],
  },
  {
    /**
     * Phase O2 — site operations.
     *
     * A section of its own rather than another item under 风险与审计, because the
     * two answer different questions: 审计日志 is what *administrators* did
     * (`AdminAuditLog`), while 访问日志 is what *everyone* did, including
     * anonymous visitors, and carries raw client IP and User-Agent.
     *
     * It therefore has its own narrower gate — `ops:read`, held by SUPER_ADMIN
     * and ANALYST only — instead of `audit:read`, which all five roles hold. The
     * nav filter drops this whole section for every other role.
     */
    title: "网站运维",
    items: [{ href: "/ops/access-logs", label: "访问日志", permission: "ops:read" }],
  },
];

/** Stroke icons, 16px, no text — the link's accessible name stays the label. */
const NAV_ICONS: Record<string, string> = {
  "/dashboard": "M3 12h6V3H3v9Zm0 9h6v-6H3v6Zm9 0h9v-9h-9v9Zm0-18v6h9V3h-9Z",
  "/users": "M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm11 9v-1a4 4 0 0 0-3-3.87",
  "/connections": "M9 17H7A5 5 0 0 1 7 7h2m6 0h2a5 5 0 0 1 0 10h-2M8 12h8",
  "/exchanges": "M4 8h13m0 0-3-3m3 3-3 3M20 16H7m0 0 3-3m-3 3 3 3",
  "/blocks": "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-3.5-4.5-9 9",
  "/reports": "M12 9v4m0 3h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  "/moderation": "M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9",
  "/risk": "M12 3 3 7v6c0 5 3.8 8.4 9 9 5.2-.6 9-4 9-9V7l-9-4Z",
  "/audit": "M12 8v4l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  // Phase O2 — a server rack / traffic glyph for the operations section.
  "/ops/access-logs": "M4 5h16v5H4V5Zm0 9h16v5H4v-5Zm3-6.5h.01M7 13.5h.01",
};

function NavIcon({ href }: { href: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={NAV_ICONS[href] ?? NAV_ICONS["/dashboard"]} />
    </svg>
  );
}

/** The one place the console's route table is rendered. */
export function AdminSidebar({
  collapsed,
  mobileOpen,
  onNavigate,
}: {
  collapsed: boolean;
  mobileOpen: boolean;
  onNavigate: () => void;
}) {
  const pathname = usePathname();
  const { identity, can } = useAdminSession();

  // A section with nothing visible in it must not leave its heading behind.
  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => can(item.permission)),
  })).filter((group) => group.items.length > 0);

  return (
    <aside
      className={[
        "fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-line bg-card",
        "transition-transform duration-200 lg:translate-x-0",
        mobileOpen ? "translate-x-0" : "-translate-x-full",
        collapsed ? "lg:w-[72px]" : "",
      ].join(" ")}
    >
      <div
        className={`flex h-16 shrink-0 items-center gap-2.5 border-b border-line ${
          collapsed ? "lg:justify-center lg:px-0" : "px-5"
        }`}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-[13px] font-semibold text-white">
          T
        </span>
        <span className={collapsed ? "lg:sr-only" : ""}>
          <span className="block text-[14px] font-semibold leading-4">TalkFirst</span>
          <span className="block text-[11px] leading-4 text-muted">管理后台</span>
        </span>
      </div>

      {identity ? (
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {groups.map((group) => (
            <div key={group.title} className="mb-5 last:mb-0">
              <p
                className={`mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted ${
                  collapsed ? "lg:hidden" : ""
                }`}
              >
                {group.title}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={[
                        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors",
                        collapsed ? "lg:justify-center lg:px-0" : "",
                        active
                          ? "bg-accent font-medium text-primary"
                          : "text-body hover:bg-subtle hover:text-ink",
                      ].join(" ")}
                    >
                      <NavIcon href={item.href} />
                      {/*
                        The label stays in the DOM when the rail is collapsed —
                        `lg:sr-only`, never `lg:hidden`. The accessible name has
                        to survive, because the suites locate navigation with
                        `getByRole("link", { name })` and read `aside nav a`.
                      */}
                      <span className={collapsed ? "lg:sr-only" : ""}>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      ) : (
        <div className="flex-1" />
      )}

      <div className={`shrink-0 border-t border-line p-3 ${collapsed ? "lg:px-2" : ""}`}>
        <p className={`px-2 text-[11px] leading-4 text-muted ${collapsed ? "lg:hidden" : ""}`}>
          权限由后端强制校验。所有封禁 / 解封 / 审核都会写入审计日志（含原因、IP、变更前后）。
        </p>
        <LogoutButton collapsed={collapsed} />
      </div>
    </aside>
  );
}

function LogoutButton({ collapsed }: { collapsed: boolean }) {
  const router = useRouter();

  async function logout() {
    await apiSend("/auth/logout", "POST").catch(() => undefined);
    router.replace("/login");
  }

  return (
    <button
      type="button"
      onClick={() => void logout()}
      className={[
        "mt-2 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-body transition-colors hover:bg-subtle hover:text-ink",
        collapsed ? "lg:justify-center lg:px-0" : "",
      ].join(" ")}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M15 17l5-5-5-5M20 12H9m0 8H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3" />
      </svg>
      <span className={collapsed ? "lg:sr-only" : ""}>退出登录</span>
    </button>
  );
}

/**
 * The 64px top bar.
 *
 * It owns three things and nothing else: the mobile drawer toggle, the current
 * section, and the signed-in identity. The identity is rendered **here and only
 * here** — the suites assert `getByText("SUPER_ADMIN", { exact: true })` and
 * `getByText("超级管理员")` each resolve to a single element, so a second copy in
 * the sidebar identity block would turn a passing test into strict-mode noise.
 */
export function AdminHeader({
  collapsed,
  onToggleCollapsed,
  onOpenMobile,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenMobile: () => void;
}) {
  const pathname = usePathname();
  const { identity } = useAdminSession();

  const current = NAV_GROUPS.flatMap((group) => group.items).find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-card/90 px-4 backdrop-blur sm:px-6">
      <button
        type="button"
        onClick={onOpenMobile}
        aria-label="打开导航"
        className="tf-btn tf-btn-ghost h-8 w-8 px-0 lg:hidden"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
        data-testid="nav-collapse-toggle"
        className="tf-btn tf-btn-ghost hidden h-8 w-8 px-0 lg:inline-flex"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16" />
        </svg>
      </button>

      <p className="truncate text-[13px] font-medium text-ink">{current?.label ?? "TalkFirst"}</p>

      <div className="ml-auto flex shrink-0 items-center gap-3">
        {identity ? (
          <>
            <div className="hidden min-w-0 text-right sm:block">
              <p className="max-w-[220px] truncate text-[12px] font-medium leading-4 text-ink">
                {identity.user.nickname ?? identity.user.email}
              </p>
              <p className="text-[11px] leading-4 text-muted">
                <span className="font-medium text-body">{identity.role}</span>
                <span> · </span>
                <span>{ROLE_LABELS[identity.role]}</span>
              </p>
            </div>
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent text-[11px] font-semibold text-primary"
              aria-hidden="true"
            >
              {(identity.user.nickname ?? identity.user.email).slice(0, 1).toUpperCase()}
            </span>
          </>
        ) : null}
      </div>
    </header>
  );
}

function AdminShell({ children }: { children: React.ReactNode }) {
  const { identity, loading, error } = useAdminSession();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Restore the operator's own density choice, after mount so the first client
  // render matches the server render.
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem("tf.admin.sidebar") === "collapsed");
    } catch {
      // A blocked storage API is not a reason to fail the console.
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((value) => {
      const next = !value;
      try {
        window.localStorage.setItem("tf.admin.sidebar", next ? "collapsed" : "expanded");
      } catch {
        // Persistence is a nicety; the toggle still works without it.
      }
      return next;
    });
  }, []);

  // The drawer must not survive a navigation, or the next screen opens behind it.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-screen bg-bg">
      {identity ? (
        <AdminSidebar
          collapsed={collapsed}
          mobileOpen={mobileOpen}
          onNavigate={() => setMobileOpen(false)}
        />
      ) : null}

      {mobileOpen ? (
        <button
          type="button"
          aria-label="关闭导航"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
        />
      ) : null}

      <div className={collapsed ? "lg:pl-[72px]" : "lg:pl-60"}>
        <AdminHeader
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          onOpenMobile={() => setMobileOpen(true)}
        />
        <main className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6">
          {loading ? <p className="text-[13px] text-muted">加载中…</p> : null}
          {!loading && error ? <p className="text-[13px] text-danger">{error}</p> : null}
          {!loading && !error ? children : null}
        </main>
      </div>
    </div>
  );
}

/**
 * The screen-level wrapper every page renders inside.
 *
 * `AdminSessionProvider` lives here, so any consumer of the session context must
 * sit *below* it — that is why each screen keeps its body in an inner component.
 * Calling `useAdminSession()` in the same component that renders `<Shell>` reads
 * the context default (`role: null`), which is how the status buttons once
 * disappeared for every role.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <AdminSessionProvider>
      <AdminShell>{children}</AdminShell>
    </AdminSessionProvider>
  );
}
