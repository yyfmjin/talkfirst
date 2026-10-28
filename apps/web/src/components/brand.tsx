import { useT } from "@/lib/i18n";
/**
 * Brand marks.
 *
 * ## 2026-10-28：换成正式标志
 *
 * 之前是对话气泡（「先说话」的隐喻）。现在有了设计交付的正式图标：
 * 三段弧环 + 笑脸（弧环的缺口正好在 0/120/240 度），品牌蓝 #0B7FFF。
 *
 * 这个组件与 `apps/mobile/assets/icon.png`、`store/brand/talkfirst-icon.svg`
 * 是同一套图形，改一处要一起改 —— 所以这里直接内联 SVG，而不是引用位图：
 * 位图在 20px 的导航栏里会糊。
 *
 * 颜色用 `bg-brand-500`：2026-10-28 界面主色已从 #3B82F6 迁到这支蓝，
 * 标志与界面现在同色，不必再写死。
 */
export const LogoMark = ({ size = 56 }: { size?: number }) => {
  return (
    <div
      className="grid place-items-center rounded-control bg-brand-500 shadow-brand"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {/* viewBox 裁到图案的包围盒（148..876），否则 1024 画布里会有大量留白 */}
      <svg width={size * 0.78} height={size * 0.78} viewBox="148 148 728 728" fill="none">
        <path d="M 927.3 623.3 A 430 430 0 0 1 400.7 927.3 L 425.3 835.6 A 335 335 0 0 0 835.6 598.7 Z" fill="white" />
        <path d="M 207.9 816.1 A 430 430 0 0 1 207.9 207.9 L 275.1 275.1 A 335 335 0 0 0 275.1 748.9 Z" fill="white" />
        <path d="M 400.7 96.7 A 430 430 0 0 1 927.3 400.7 L 835.6 425.3 A 335 335 0 0 0 425.3 188.4 Z" fill="white" />
        <circle cx="407" cy="457" r="26" fill="white" />
        <circle cx="617" cy="457" r="26" fill="white" />
        <path d="M 596.6 582.8 A 90 90 0 0 1 427.4 582.8" fill="none" stroke="white" strokeWidth="26" strokeLinecap="round" />
      </svg>
    </div>
  );
};

export const Wordmark = () => (
  <span aria-hidden="true" className="text-center">
    <span className="block text-title font-semibold tracking-tight text-content">TalkFirst</span>
    <span className="mt-1 block text-caption text-content-muted">Talk First. Connect Later.</span>
  </span>
);

/**
 * The slogan lockup — 「先聊聊，再成为朋友。」
 *
 * Separate from `Wordmark` because it is copy, not branding: it is the product's
 * one-line explanation and it needs to be readable at body size, not shrunk into
 * a logo caption. The launch screen and the empty states both want it.
 */
export const Slogan = ({ className }: { className?: string }) => {
  const { t } = useT();
  return <p className={className}>{t("brand.slogan")}</p>;
};
