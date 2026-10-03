import { cn } from "@/lib/cn";
import { PhoneStatusBar } from "@/components/phone-status-bar";

/**
 * PhoneShell — the device frame the member app is reviewed inside.
 *
 * ## What changed in Phase B
 *
 * Only tokens and the desktop canvas. The geometry is deliberately unchanged,
 * because 9 of the 35 routes render inside this frame and every one of them
 * depends on it for scrolling:
 *
 *   - below `sm` the frame fills the viewport (`h-[100dvh] w-full`);
 *   - at `sm` and up it becomes a 390×844 device centred on a tinted canvas.
 *
 * Two things are load-bearing and must not be "tidied away":
 *
 *  1. **The inner wrapper is `relative`.** `TFSheet` / `TFDialog` / `TFMenu`
 *     position with `absolute`, precisely so a dialog stays inside the device
 *     frame instead of floating in the middle of a 1440px monitor — which is
 *     what the old `fixed inset-0` overlays did. Removing `relative` here would
 *     push every overlay back to the viewport.
 *  2. **`overflow-hidden` on both levels.** A page's own scroller is the
 *     `min-h-0 flex-1 overflow-y-auto` child it renders; without these two the
 *     frame would grow instead of the content scrolling, and the bottom nav would
 *     be pushed off-screen.
 *
 * The desktop canvas moves from an arbitrary `#EEF3FF` to `surface-canvas`, and
 * the frame radius to `rounded-frame` (32px). The frame is capped at 844px so it
 * never exceeds a laptop viewport; on a shorter window it shrinks
 * (`max-h-[calc(100dvh-2rem)]`) rather than clipping the bottom nav.
 */
export function PhoneShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <main className="flex min-h-[100dvh] items-start justify-center bg-surface-canvas p-0 sm:items-center sm:p-4 md:p-8">
      <div
        className={cn(
          "relative flex h-[100dvh] w-full flex-col overflow-hidden bg-surface",
          "sm:h-[844px] sm:max-h-[calc(100dvh-2rem)] sm:w-[390px] sm:rounded-frame sm:shadow-phone",
          className,
        )}
      >
        <PhoneStatusBar />
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      </div>
    </main>
  );
}
