import { PhoneShell } from "@/components/phone-shell";
import { TFButton, TFCard } from "@/components/tf";

/**
 * Onboarding finished — the hand-off into the product.
 *
 * This is the last screen before the member sees other people, so the job is to
 * answer "what now?" rather than to celebrate. The old version was a 40×40
 * decoration and a two-line exclamation; it told the member nothing about what
 * they had just built or what the app would now do with it.
 *
 * The three lines below are the actual contract of the product as built: you get
 * recommended to people, you say hello first, and contact details move only after
 * both sides agree. Setting that expectation here is cheaper than explaining it
 * later in a conversation.
 *
 * Server Component — only the link is interactive.
 */
export default function CompletePage() {
  return (
    <PhoneShell>
      <div className="tf-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-10">
        <div className="flex flex-col items-center text-center">
          {/* The bubble motif, earned this time: onboarding is where the member
              learns that a reply is the point. */}
          <span
            aria-hidden="true"
            className="grid h-20 w-20 place-items-center rounded-card bg-brand-500 shadow-brand"
          >
            <svg width="44" height="44" viewBox="0 0 48 48" fill="none">
              <path
                d="M10 18c0-5.5 6.3-9 14-9s14 3.5 14 9-6.3 9-14 9c-1.4 0-2.7-.1-4-.4L14 32l1.6-5.2C11.8 24.8 10 21.6 10 18Z"
                fill="white"
              />
              <circle cx="20" cy="18" r="2" fill="#3B82F6" />
              <circle cx="28" cy="18" r="2" fill="#3B82F6" />
            </svg>
          </span>
          <h1 className="mt-6 text-title font-semibold text-content">名片创建完成</h1>
          <p className="mt-2 max-w-[290px] text-ui leading-6 text-content-muted">
            你可以开始认识新朋友了。
          </p>
        </div>

        <TFCard tone="quiet" className="mt-7">
          <ul className="space-y-3">
            {[
              { title: "会被推荐给聊得来的人", body: "推荐依据是你们的母语、正在学的语言和共同兴趣。" },
              { title: "由你先开口", body: "在「发现」里挑一个头像，说第一句话。打招呼不消耗次数。" },
              { title: "联系方式由双方决定", body: "只有你们都同意交换，社交账号才会互相可见。" },
            ].map((item) => (
              <li key={item.title} className="flex gap-3">
                <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                <span className="min-w-0">
                  <span className="block text-ui font-medium text-content">{item.title}</span>
                  <span className="mt-0.5 block text-caption leading-5 text-content-muted">{item.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </TFCard>

        <div className="mt-auto pt-9">
          <TFButton href="/discover" size="lg" fullWidth>
            去发现新朋友
          </TFButton>
          <TFButton href="/me/edit" variant="ghost" size="md" fullWidth className="mt-1">
            先回去改改名片
          </TFButton>
        </div>
      </div>
    </PhoneShell>
  );
}
