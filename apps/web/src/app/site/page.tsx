import type { Metadata } from "next";
import Link from "next/link";
import { LogoMark } from "@/components/brand";
import { TFBadge, TFButton, TFCard } from "@/components/tf";

/**
 * 官网（`/site`）—— 面向「还没注册的人」的一页。
 *
 * ## 它和 `/`（`app/page.tsx`）的关系
 *
 * `/` 是产品内的启动屏：手机尺寸、套在 `PhoneShell` 里、只回答「这是什么」+
 * 一个动作。这里是**外部**页面：桌面优先、不套手机壳、信息量更大 ——
 * 产品是什么、怎么用、安全怎么保证、去哪儿下载。
 *
 * 两者刻意不合并：把官网塞进 390px 的手机壳里，等于用 App 的版式讲一个
 * 还没装 App 的人需要的故事。哪天要让官网当域名首页（`talkfirst.ccwu.cc/`），
 * 只需要把 `/` 指到这里、把现在的启动屏挪到 `/app` 之类 —— **改动是一处路由**，
 * 不动这一页的内容。
 *
 * ## 刻意没有的东西
 *
 * - **没有仿真状态栏**：手机预览图顶部不画时间 / 信号 / 电池。
 *   那条仿真件刚从成员端外壳上删掉（见 `components/phone-shell.tsx` 的说明），
 *   官网再画一个只会是同一个错误换个地方出现。
 * - **没有渐变、没有动画**：主色是 `brand-500` 的实色，唯一动效是按钮的按压态。
 * - **没有 emoji 当图标**：三处图标都是内联 SVG（`aria-hidden`），emoji 在不同系统
 *   上字形和基线都不一样，在正式产品页上会更明显。
 * - **没有假数据**：不写「已有 100 万用户」这类编出来的数字。现在能说的是内测、
 *   免费、功能还在长。
 */

/**
 * Android 安装包地址（EAS 构建产物 —— `artifacts.buildUrl`）。
 *
 * 留空时下方按钮显示「内测包生成中」并且**不可点**：这里放一个 `#` 或
 * 指向构建后台的链接，等于把一个死链摆给用户。出包后把地址填进来即可。
 */
const ANDROID_APK_URL = "";

const FEATURES = [
  {
    title: "语言交换",
    body: "你会中文、对方想学中文；对方会英语、你想练英语。话题从语言本身开始，不用硬找共同点。",
    icon: "language",
  },
  {
    title: "兴趣搭子",
    body: "游戏、音乐、电影、旅行 —— 按兴趣找人，聊的是事情本身，不是「在吗」。",
    icon: "spark",
  },
  {
    title: "先聊，再连",
    body: "打招呼 → 对方接受 → 才能互发消息。没有滑卡片，也没有一注册就被一百个人私信。",
    icon: "bubble",
  },
] as const;

const STEPS = [
  { title: "注册并说明你想练什么", body: "母语、在学的语言、兴趣和目的。推荐会照着这些来。" },
  { title: "在「发现」里打个招呼", body: "每天有限的推荐名额，逼你把话说完，而不是群发。" },
  { title: "双方接受后开始聊天", body: "聊得来再交换联系方式；不顺心随时可以拉黑。" },
] as const;

const SAFETY = [
  "双方任何一侧都能拉黑与举报，举报会有人看。",
  "动态与评论先过审再公开，不是发出去再说。",
  "注册要验证邮箱，减少机器账号。",
  "交换联系方式必须双方同意 —— 对方不同意，你的联系方式不会到达对方。",
] as const;

export const metadata: Metadata = {
  title: "官网 —— 下载应用",
  description:
    "TalkFirst 先聊：语言交换与跨文化社交应用。先聊聊，再成为朋友。Android 内测版可直接下载安装。",
  alternates: { canonical: "/site" },
};

export default function OfficialSitePage() {
  const hasApk = ANDROID_APK_URL.length > 0;

  return (
    <div className="min-h-screen bg-surface-canvas">
      {/* ── 顶栏 ───────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <Link href="/site" className="flex items-center gap-2.5" aria-label="TalkFirst 官网首页">
            <LogoMark size={32} />
            <span className="text-heading font-semibold tracking-tight text-content">TalkFirst</span>
          </Link>

          <nav aria-label="页面导航" className="hidden items-center gap-7 md:flex">
            <a href="#features" className="text-ui text-content-muted transition-colors hover:text-content">
              产品
            </a>
            <a href="#how" className="text-ui text-content-muted transition-colors hover:text-content">
              怎么用
            </a>
            <a href="#safety" className="text-ui text-content-muted transition-colors hover:text-content">
              安全
            </a>
            <a href="#download" className="text-ui text-content-muted transition-colors hover:text-content">
              下载
            </a>
          </nav>

          {/* 顶栏不放主按钮：整页只允许一个 primary（见 tf/index.ts 的规则）。 */}
          <Link
            href="/login"
            className="text-ui font-medium text-brand-600 underline-offset-4 hover:underline"
          >
            登录 / 注册
          </Link>
        </div>
      </header>

      <main>
        {/* ── 主视觉 ─────────────────────────────────────────────────── */}
        <section className="mx-auto grid max-w-5xl items-center gap-12 px-6 py-16 md:grid-cols-[1.1fr_0.9fr] md:py-24">
          <div>
            <TFBadge tone="brand">内测中 · Android 可装</TFBadge>

            <h1 className="mt-5 text-display font-semibold tracking-tight text-content">
              先聊聊，再成为朋友。
            </h1>

            <p className="mt-5 max-w-xl text-body text-content-muted">
              TalkFirst 是一个语言交换与兴趣社交应用。它不让你先「通过」再尬聊，
              而是先聊得下去，再决定要不要加好友 —— 所以第一步是打招呼，不是滑卡片。
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              {hasApk ? (
                <TFButton variant="primary" size="lg" href={ANDROID_APK_URL}>
                  下载 Android 版（APK）
                </TFButton>
              ) : (
                <TFButton variant="secondary" size="lg" disabled>
                  内测包生成中
                </TFButton>
              )}
              <TFButton variant="secondary" size="lg" href="/login">
                先在浏览器里用
              </TFButton>
            </div>

            <p className="mt-4 text-caption text-content-subtle">
              内测版：功能会持续更新，安装包直接下载安装，不需要应用商店。
              iOS 版在准备中。
            </p>
          </div>

          <PhonePreview />
        </section>

        {/* ── 产品 ───────────────────────────────────────────────────── */}
        <section id="features" className="border-t border-border bg-surface py-16 md:py-20">
          <div className="mx-auto max-w-5xl px-6">
            <h2 className="text-title font-semibold tracking-tight text-content">它是什么</h2>
            <p className="mt-3 max-w-2xl text-body text-content-muted">
              三件事，按重要程度排：语言、兴趣、以及「先聊天」这个顺序。
            </p>

            <div className="mt-10 grid gap-5 md:grid-cols-3">
              {FEATURES.map((feature) => (
                <TFCard key={feature.title} className="p-6">
                  <FeatureIcon name={feature.icon} />
                  <h3 className="mt-4 text-heading font-semibold text-content">{feature.title}</h3>
                  <p className="mt-2 text-body text-content-muted">{feature.body}</p>
                </TFCard>
              ))}
            </div>
          </div>
        </section>

        {/* ── 怎么用 ─────────────────────────────────────────────────── */}
        <section id="how" className="py-16 md:py-20">
          <div className="mx-auto max-w-5xl px-6">
            <h2 className="text-title font-semibold tracking-tight text-content">怎么用</h2>
            <ol className="mt-10 grid gap-8 md:grid-cols-3">
              {STEPS.map((step, index) => (
                <li key={step.title}>
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-100 text-ui font-semibold text-brand-700">
                    {index + 1}
                  </span>
                  <h3 className="mt-4 text-heading font-semibold text-content">{step.title}</h3>
                  <p className="mt-2 text-body text-content-muted">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── 安全 ───────────────────────────────────────────────────── */}
        <section id="safety" className="border-t border-border bg-surface py-16 md:py-20">
          <div className="mx-auto max-w-5xl px-6">
            <h2 className="text-title font-semibold tracking-tight text-content">安全</h2>
            <p className="mt-3 max-w-2xl text-body text-content-muted">
              和陌生人说话是这个产品的全部意义，所以下面的每一条都必须是能做到的，
              而不是写在官网上的口号。
            </p>
            <ul className="mt-8 grid gap-4 md:grid-cols-2">
              {SAFETY.map((item) => (
                <li key={item} className="flex gap-3 text-body text-content-muted">
                  <CheckIcon />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── 下载 ───────────────────────────────────────────────────── */}
        <section id="download" className="py-16 md:py-20">
          <div className="mx-auto max-w-5xl px-6">
            <h2 className="text-title font-semibold tracking-tight text-content">下载</h2>

            <div className="mt-8 grid gap-5 md:grid-cols-2">
              <TFCard className="p-6">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-heading font-semibold text-content">Android</span>
                  <TFBadge tone={hasApk ? "success" : "warning"} dot>
                    {hasApk ? "可下载" : "生成中"}
                  </TFBadge>
                </div>
                <p className="mt-2 text-body text-content-muted">
                  直接下载 APK 安装。第一次安装时系统会问「是否允许来自此来源的应用」，
                  允许即可。
                </p>
                <div className="mt-5">
                  {hasApk ? (
                    <TFButton variant="primary" href={ANDROID_APK_URL}>
                      下载 APK
                    </TFButton>
                  ) : (
                    <TFButton variant="secondary" disabled>
                      内测包生成中
                    </TFButton>
                  )}
                </div>
              </TFCard>

              <TFCard tone="quiet" className="p-6">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-heading font-semibold text-content">iOS</span>
                  <TFBadge tone="neutral">即将上线</TFBadge>
                </div>
                <p className="mt-2 text-body text-content-muted">
                  iPhone 版在准备中。在这之前，网页版能用到绝大部分功能：
                  发现、动态、聊天、通知。
                </p>
                <div className="mt-5">
                  <TFButton variant="secondary" href="/login">
                    用网页版
                  </TFButton>
                </div>
              </TFCard>
            </div>
          </div>
        </section>
      </main>

      {/* ── 页脚 ─────────────────────────────────────────────────────── */}
      <footer className="border-t border-border bg-surface py-10">
        <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2.5">
            <LogoMark size={28} />
            <span className="text-ui font-medium text-content">TalkFirst</span>
            <span className="text-caption text-content-subtle">Talk First. Connect Later.</span>
          </div>

          <nav aria-label="页脚导航" className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link href="/legal/terms" className="text-caption text-content-muted hover:text-content">
              用户协议
            </Link>
            <Link href="/legal/privacy" className="text-caption text-content-muted hover:text-content">
              隐私政策
            </Link>
            <Link href="/legal/rules" className="text-caption text-content-muted hover:text-content">
              社区规则
            </Link>
            <a
              href="mailto:support@talkfirst.ccwu.cc"
              className="text-caption text-content-muted hover:text-content"
            >
              support@talkfirst.ccwu.cc
            </a>
          </nav>

          <p className="text-caption text-content-subtle">© 2026 TalkFirst</p>
        </div>
      </footer>
    </div>
  );
}

/**
 * 主视觉里的手机预览。
 *
 * 刻意**不画状态栏**（时间 / 信号 / 电池）：那是真机才有的东西，画在网页上的
 * 手机模型里就是一层假象。框子只表达「这是手机上的样子」—— 圆角、边框、
 * 一个真实的界面片段。
 */
function PhonePreview() {
  return (
    <div className="justify-self-center">
      <div className="w-[280px] rounded-frame border border-border bg-surface p-3 shadow-phone">
        <div className="overflow-hidden rounded-card border border-border">
          {/* 一条动态：作者 + 正文 + 计数 */}
          <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
            <span
              aria-hidden="true"
              className="grid h-8 w-8 place-items-center rounded-full bg-brand-100 text-caption font-semibold text-brand-700"
            >
              A
            </span>
            <span className="text-ui font-medium text-content">小秋</span>
            <span className="text-caption text-content-subtle">日本 · 3 分钟前</span>
          </div>
          <p className="px-4 py-3 text-body text-content">
            今天在学「差不多」和「几乎」的区别，中文的同义词真的太微妙了。
          </p>
          <div className="flex items-center gap-5 border-t border-border px-4 py-2.5 text-caption text-content-muted">
            {/* 计数用字写：「赞 12 / 评论 4」。不用 ♥ / 💬 这类字符 —— 它们是 emoji/
                装饰字符，字形随系统变，与上面的图标规则自相矛盾。 */}
            <span>赞 12</span>
            <span>评论 4</span>
          </div>

          {/* 一段对话：两条气泡 */}
          <div className="space-y-2 border-t border-border bg-surface-sunken px-4 py-3">
            <p className="max-w-[80%] rounded-row bg-surface px-3 py-2 text-ui text-content">
              你也在学日语吗？
            </p>
            <p className="ml-auto max-w-[80%] rounded-row bg-brand-500 px-3 py-2 text-ui text-content-inverse">
              在学！我可以帮你纠中文。
            </p>
          </div>
        </div>
      </div>

      <p className="mt-4 text-center text-caption text-content-subtle">
        应用内的样子（预览）
      </p>
    </div>
  );
}

/** 三个产品图标。内联 SVG，不用 emoji：emoji 的字形随系统变，也不受颜色令牌控制。 */
function FeatureIcon({ name }: { name: "language" | "spark" | "bubble" }) {
  const paths: Record<typeof name, string> = {
    language: "M4 6h10M9 4v2M6 6c0 4 3 7 7 8M12 6c-.5 3-3 6-6 7M13 20l3.5-8 3.5 8M15 17h5",
    spark: "M12 3l1.8 4.9L18.7 9l-4.9 1.8L12 15.7l-1.8-4.9L5.3 9l4.9-1.1L12 3ZM18 16l.9 2.1 2.1.9-2.1.9L18 22l-.9-2.1-2.1-.9 2.1-.9L18 16Z",
    bubble: "M4 11c0-3.9 3.6-7 8-7s8 3.1 8 7-3.6 7-8 7c-.8 0-1.6-.1-2.3-.3L6 20l1-3.2C5.1 15.6 4 13.4 4 11Z",
  };

  return (
    <span
      aria-hidden="true"
      className="grid h-10 w-10 place-items-center rounded-control bg-surface-sunken text-brand-600"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-5 w-5">
        <path d={paths[name]} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      className="mt-0.5 h-4 w-4 shrink-0 text-success-600"
    >
      <path d="M4 10.5l4 4 8-9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
