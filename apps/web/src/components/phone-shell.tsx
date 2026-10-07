import { cn } from "@/lib/cn";

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
 *
 * ## 2026-10-08 — 顶部那个仿真状态栏删掉了
 *
 * 之前框里有一条仿 iOS 的顶栏：本地时间 + `●●● ▲ ■`（信号 / WiFi / 电池）。
 * 用户的原话是「把页面上面的时间跟手机模拟的信号图标删掉」—— 它们模拟的是**设备**，
 * 而这里显示的是网页；一个手机浏览器里再套一层手机顶栏，既有假时间又说不出任何事。
 *
 * 删得很干净：组件 `phone-status-bar.tsx` 与它的 E2E 用例（`test/e2e/phone-status-bar.spec.ts`）
 * 一起删了 —— 用例测的是那个组件的存在与计时器，组件没了用例就是死的。
 *
 * 保留的只是 **`h-3`的空白条**（原来是 `pt-3` + 一行 12px 文字 + `pb-1`）：
 * 它让内容不要顶着 `rounded-frame` 的圆角、也不贴屏幕最上沿。把高度从 32px
 * 改成 12px 是故意的 —— 仿真件没了，留一整条空的“状态栏高度”只会看着像 bug。
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
        {/* 曾经是 <PhoneStatusBar />（假时间 + 假信号图标）。现在只是一条留白，
            让内容不贴圆角上沿 —— 见文件顶部的说明。 */}
        <div aria-hidden="true" className="h-3 shrink-0" />
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      </div>
    </main>
  );
}
