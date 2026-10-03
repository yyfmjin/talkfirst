import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { TabBar } from "@/components/tab-bar";
import { TFCard } from "@/components/tf";

const ADMIN_CONSOLE_URL =
  process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3001";

/**
 * Phase A: this route used to host a second, fully-featured admin console
 * inside the public user app. That duplicated `apps/admin` and meant every RBAC
 * change had to be applied twice — miss one and an authorization bypass stays
 * open. Admin functionality now lives only in the standalone console.
 *
 * This page is kept as a signpost so existing bookmarks and the in-app entry
 * button still resolve, but it holds no admin capability of its own.
 */
export default function AdminRedirectPage() {
  return (
    <PhoneShell>
      <ScreenHeader title="管理后台" backHref="/me" />
      <div className="px-5 pt-6">
        <TFCard>
          <p className="text-body font-semibold text-content">后台已独立部署</p>
          <p className="mt-2 text-ui leading-6 text-content-muted">
            管理后台已迁移到独立应用，不再在用户端内提供。请使用独立后台地址登录：
          </p>
          {/* The URL is shown so it can be copied; `select-all` makes one tap
              select the whole thing on mobile. */}
          <p className="mt-3 select-all break-all rounded-control bg-surface-sunken px-3 py-2 text-caption text-brand-600">
            {ADMIN_CONSOLE_URL}
          </p>
          {/* Deliberately a PLAIN `<a>`, not `TFButton href`.
              - The destination is a different origin (`:3001`). `TFButton`'s href
                branch renders a Next `<Link>`, which is for in-app routes.
              - `TFButton`'s href branch also does NOT forward extra props, so
                `target`/`rel` would be silently dropped — and its prop type is
                `ButtonHTMLAttributes`, which has no `rel`.
              A cross-origin signpost is the one place a full page load is correct,
              so this keeps the raw anchor and only tokenises its appearance. */}
          <a
            href={ADMIN_CONSOLE_URL}
            rel="noopener noreferrer"
            className="mt-4 flex h-12 w-full items-center justify-center rounded-control bg-brand-500 text-body font-semibold text-white shadow-brand transition-colors duration-instant hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2"
          >
            前往管理后台
          </a>
          <p className="mt-3 text-overline leading-5 text-content-muted">
            权限由后端强制校验，仅具备管理员角色的账号可以进入。
          </p>
        </TFCard>
      </div>
      <TabBar active="/me" />
    </PhoneShell>
  );
}
