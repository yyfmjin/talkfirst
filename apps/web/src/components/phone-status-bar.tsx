"use client";

import { useEffect, useState } from "react";

/**
 * The simulated status bar of the phone shell that frames the web app.
 *
 * The shell exists so the product can be reviewed at phone dimensions in a
 * browser; it is not part of the app itself. The clock therefore reports the
 * viewer's own local time instead of the "9:41" placeholder from the design
 * file, and the glyphs on the right are decoration only — they never read a
 * real device's signal, network or battery. When TalkFirst ships as a real
 * React Native app the shell goes away and Android/iOS draw this bar.
 *
 * The time starts as `null` so the server-rendered markup and the first client
 * render agree; the effect fills it in immediately after hydration.
 */
export function PhoneStatusBar() {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      // Pad by hand rather than using toLocaleTimeString: that would honour the
      // viewer's locale, which happily renders "9:41" with a single-digit hour.
      const hours = String(now.getHours()).padStart(2, "0");
      const minutes = String(now.getMinutes()).padStart(2, "0");
      setTime(`${hours}:${minutes}`);
    };

    tick();
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div
      data-testid="phone-status-bar"
      className="pointer-events-none z-10 flex shrink-0 items-center justify-between bg-white/95 px-6 pb-1 pt-3 text-[12px] font-medium text-ink/80"
    >
      <span data-testid="phone-status-bar-time" className="tabular-nums">
        {time}
      </span>
      {/* Decorative stand-ins for the system glyphs — deliberately faint so they
          read as part of the shell rather than as app chrome. */}
      <span aria-hidden="true" className="flex items-center gap-1 text-[11px] text-ink/40">
        <span>●●●</span>
        <span>▲</span>
        <span>■</span>
      </span>
    </div>
  );
}
