"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Compass, Images, MessageCircle, Users, UserRound } from "lucide-react";
import { cn } from "@/lib/cn";
import { apiFetch } from "@/lib/api";

const items = [
  { href: "/discover", label: "发现", icon: Compass, match: ["/discover"] },
  { href: "/moments", label: "动态", icon: Images, match: ["/moments"] },
  { href: "/messages", label: "消息", icon: MessageCircle, match: ["/messages"] },
  { href: "/connections", label: "连接", icon: Users, match: ["/connections"] },
  { href: "/me", label: "我的", icon: UserRound, match: ["/me", "/admin", "/onboarding"] },
];

export function TabBar({ active }: { active: string }) {
  const pathname = usePathname();
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
    const timer = setInterval(() => void load(), 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <nav className="z-10 grid shrink-0 grid-cols-5 border-t border-line bg-white/95 px-1 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2 backdrop-blur">
      {items.map((item) => {
        const Icon = item.icon;
        const current = pathname ?? active;
        const isActive = current === item.href || item.match.some((prefix) => current.startsWith(prefix));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "relative flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-xl text-[11px]",
              isActive ? "font-semibold text-[#6B7CFF]" : "text-muted",
            )}
          >
            {isActive ? <span className="absolute top-0 h-1 w-8 rounded-full bg-[#6B7CFF]" /> : null}
            <span className="relative">
              <Icon size={20} />
              {item.href === "/messages" && unread > 0 ? (
                <span className="absolute -right-2 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-semibold text-white">
                  {unread > 99 ? "99+" : unread}
                </span>
              ) : null}
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
