"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export function ScreenHeader({
  title,
  backHref,
  action,
}: {
  title: string;
  backHref: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="z-10 grid shrink-0 grid-cols-[auto_1fr_auto] items-center gap-2 border-b border-line/70 bg-white/95 px-3 py-2 backdrop-blur">
      <Link
        href={backHref}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink transition active:scale-95"
        aria-label="返回"
      >
        <ChevronLeft size={22} />
      </Link>
      <h1 className="min-w-0 truncate text-center text-[16px] font-medium">{title}</h1>
      <div className="flex min-w-[2.25rem] shrink-0 items-center justify-end">{action}</div>
    </header>
  );
}
