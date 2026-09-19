export const LogoMark = ({ size = 56 }: { size?: number }) => {
  return (
    <div
      className="tf-gradient grid place-items-center rounded-[22px] shadow-lg shadow-indigo-200"
      style={{ width: size, height: size }}
    >
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 48 48" fill="none">
        <path
          d="M10 18c0-5.5 6.3-9 14-9s14 3.5 14 9-6.3 9-14 9c-1.4 0-2.7-.1-4-.4L14 32l1.6-5.2C11.8 24.8 10 21.6 10 18Z"
          fill="white"
        />
        <circle cx="20" cy="18" r="2" fill="#8B6CFF" />
        <circle cx="28" cy="18" r="2" fill="#8B6CFF" />
      </svg>
    </div>
  );
};

export const Wordmark = () => (
  <div className="text-center">
    <h1 className="text-[34px] font-semibold tracking-tight text-ink">TalkFirst</h1>
    <p className="mt-1 text-sm text-muted">先聊聊，再成为朋友。</p>
    <p className="text-xs text-muted/80">Talk First. Connect Later.</p>
  </div>
);
