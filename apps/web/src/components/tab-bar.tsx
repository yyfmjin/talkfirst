"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Compass, Images, MessageCircle, Plus, UserRound } from "lucide-react";
import { cn } from "@/lib/cn";
import { apiFetch } from "@/lib/api";
import { localePath, type MsgKey } from "@/lib/i18n";
import { useT } from "@/lib/i18n/use-locale";

/**
 * TabBar — the bottom navigation.
 *
 * ## Structure (Phase B)
 *
 *   ⬚ 首页   ⬚ 发现   ⊕   ⬚ 消息   ⬚ 我的
 *
 * Five slots, with the centre one as a **primary action** rather than a
 * destination: a filled brand-blue circle opening the composer. That is the rule
 * the brief states, and it is also what makes the app read as a social product
 * rather than as five equal CRUD sections — posting is the one thing the product
 * wants a member to do, so it gets the only filled control on the chrome.
 *
 * ## What moved
 *
 * 连接 used to own the fourth slot. It does not any more: the brief fixes the
 * five slots above, and a relationship list is not something a member checks
 * repeatedly throughout the day, whereas their own moments and messages are.
 * The route still exists and is now reached from 「我的」, so no capability was
 * removed — see `app/me/page.tsx`. The other three slots keep their existing
 * labels (发现 / 消息 / 我的) because both the E2E suite and learned user
 * behaviour depend on them.
 *
 * ## Accessibility
 *
 * A `nav` landmark with a name, `aria-current="page"` on the active tab, and a
 * text label under every icon (so no icon is unlabelled). The unread pill carries
 * an accessible description instead of relying on the digits alone.
 *
 * The badge is a light brand tint, not the old `bg-red-500` — a red dot on the
 * chrome reads as "error", and an unread message is not an error. The brief asks
 * for a quiet indicator; the count still appears in the tab's accessible name.
 */

type Tab = {
  href: string;
  labelKey: MsgKey;
  icon: typeof Compass;
  /** Path prefixes that keep this tab active. */
  match: string[];
};

const TABS: Tab[] = [
  { href: "/moments", labelKey: "nav.home", icon: Images, match: ["/moments"] },
  { href: "/discover", labelKey: "nav.discover", icon: Compass, match: ["/discover", "/profile"] },
  /* 连接 lives under this tab now (see the docblock). */
  {
    href: "/messages",
    labelKey: "nav.messages",
    icon: MessageCircle,
    match: ["/messages", "/notifications", "/connections"],
  },
  { href: "/me", labelKey: "nav.me", icon: UserRound, match: ["/me", "/admin", "/onboarding"] },
];

export function TabBar({ active }: { active?: string }) {
  const pathname = usePathname();
  const { locale, t } = useT();
  const current = pathname ?? active ?? "";
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [notices, conversations] = await Promise.all([
          apiFetch<{ unread: number }>("/notifications").catch(() => ({ unread: 0 })),
          apiFetch<Array<{ unreadCount?: number }>>("/conversations").catch(() => []),
        ]);
        if (cancelled) return;
        const chatUnread = conversations.reduce((sum, item) => sum + (item.unreadCount ?? 0), 0);
        setUnread((notices.unread ?? 0) + chatUnread);
      } catch {
        if (!cancelled) setUnread(0);
      }
    }
    void load();
    /* Polling rather than a socket subscription: the badge must be right on a
     * cold load, and notifications have no push channel yet. 30s is the interval
     * this already used; it is cleared on unmount so a client-side navigation
     * cannot accumulate timers (the status-bar suite asserts exactly that). */
    const timer = setInterval(() => void load(), 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const isActive = (tab: Tab) => current === tab.href || tab.match.some((prefix) => current.startsWith(prefix));
  const composeActive = current.startsWith("/moments/compose");

  return (
    <nav
      aria-label={t("nav.primaryNav")}
      data-testid="tab-bar"
      className="z-10 shrink-0 border-t border-border bg-surface/95 backdrop-blur"
    >
      <div className="grid grid-cols-5 items-end px-1 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-1.5">
        {/* Slots 1–2 */}
        {TABS.slice(0, 2).map((tab) => (
          <TabLink key={tab.href} tab={tab} active={isActive(tab)} t={t} locale={locale} />
        ))}

        {/* Slot 3 — the primary action, deliberately not a destination. */}
        <div className="flex justify-center">
          <Link
            href="/moments/compose"
            aria-label={t("nav.compose")}
            aria-current={composeActive ? "page" : undefined}
            className={cn(
              "-mt-4 grid h-12 w-12 place-items-center rounded-full",
              "bg-brand-500 text-white shadow-brand",
              "transition-transform duration-instant ease-out active:scale-95 motion-reduce:transition-none",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2",
            )}
          >
            <Plus size={24} strokeWidth={2.4} aria-hidden="true" />
          </Link>
        </div>

        {/* Slots 4–5 */}
        {TABS.slice(2).map((tab) => (
          <TabLink
            key={tab.href}
            tab={tab}
            active={isActive(tab)}
            badge={tab.href === "/messages" && unread > 0 ? unread : undefined}
            t={t}
            locale={locale}
          />
        ))}
      </div>
    </nav>
  );
}

function TabLink({
  tab,
  active,
  badge,
  t,
  locale,
}: {
  tab: Tab;
  active: boolean;
  badge?: number;
  t: ReturnType<typeof useT>["t"];
  locale: ReturnType<typeof useT>["locale"];
}) {
  const Icon = tab.icon;
  const label = t(tab.labelKey);
  return (
    <Link
      href={localePath(locale, tab.href)}
      aria-current={active ? "page" : undefined}
      aria-label={badge ? t("nav.unreadBadge", { label, count: badge }) : label}
      className={cn(
        "relative flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-row px-1",
        "transition-colors duration-instant ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300",
        active ? "text-brand-500" : "text-content-subtle hover:text-content-muted",
      )}
    >
      <span className="relative">
        <Icon size={22} strokeWidth={active ? 2.4 : 2} aria-hidden="true" />
        {badge ? (
          <span
            aria-hidden="true"
            className="absolute -right-2.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-brand-500 px-1 text-[10px] font-semibold leading-none text-white"
          >
            {badge > 99 ? "99+" : badge}
          </span>
        ) : null}
      </span>
      <span className={cn("text-overline", active ? "font-semibold" : "font-medium")}>{label}</span>
    </Link>
  );
}
