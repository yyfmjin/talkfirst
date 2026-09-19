import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { TabBar } from "@/components/tab-bar";

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
        <div className="rounded-3xl border border-line bg-white p-5">
          <p className="text-[15px] font-semibold">后台已独立部署</p>
          <p className="mt-2 text-[13px] leading-6 text-muted">
            管理后台已迁移到独立应用，不再在用户端内提供。请使用独立后台地址登录：
          </p>
          <p className="mt-3 break-all rounded-xl bg-[#F7F9FF] px-3 py-2 text-[12px] text-[#6572D8]">
            {ADMIN_CONSOLE_URL}
          </p>
          <a
            href={ADMIN_CONSOLE_URL}
            className="mt-4 flex h-11 w-full items-center justify-center rounded-2xl bg-[#16213A] text-[14px] font-medium text-white"
          >
            前往管理后台
          </a>
          <p className="mt-3 text-[11px] leading-5 text-muted">
            权限由后端强制校验，仅具备管理员角色的账号可以进入。
          </p>
        </div>
      </div>
      <TabBar active="/me" />
    </PhoneShell>
  );
}
