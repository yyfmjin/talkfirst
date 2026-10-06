"use client";

import Link from "next/link";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";

/**
 * 社区规则（公开可读）。
 *
 * ## 为什么这一页必须存在
 *
 * 注册页写着「注册即表示同意社区规则」，但**全仓库没有一份社区规则** ——
 * 一句指向空白页的同意，等于没有同意。`/legal` 的同意闸门同样把
 * 「账号规则、内容规范」作为勾选项的说明，而那份规范此前不存在。
 *
 * ## DRAFT — needs review before launch
 *
 * 与 `/legal/privacy` 同一处境：文本由工程师起草，不是法律意见。
 * 事实部分逐条对照**已实现**的审核能力写过：举报的四种目标
 * （动态 / 评论 / 消息 / 用户）、举报理由由服务端白名单校验、
 * 举报人会收到处理结果通知而不暴露举报人、处理手段包含
 * 临时暂停（到期自动解除）与永久封禁。运营主体与联系方式这两项
 * 只有运营方能提供，见 `docs/LEGAL-TEXTS.md`。
 */

/** Shared paragraph shape, so the page reads as one document. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="text-heading font-semibold text-content">{title}</h2>
      <div className="mt-2 space-y-2 text-ui leading-6 text-content-muted">{children}</div>
    </section>
  );
}

export default function CommunityRulesPage() {
  return (
    <PhoneShell>
      <ScreenHeader title="社区规则" backHref="/legal" />
      <div className="tf-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-10 pt-4">
        <p className="text-caption text-content-subtle">最近更新：2026 年 10 月</p>

        <p className="mt-4 text-ui leading-6 text-content-muted">
          TalkFirst 想让你先聊得来、再决定要不要成为朋友。这需要每个人在这里都能放松地说话，
          所以下面这些是大家共同遵守的约定。本规则是《用户协议》的一部分。
        </p>

        <Section title="1. 我们的底线">
          <ul className="ml-4 list-disc space-y-1">
            <li>尊重对方：语言交换与交朋友都建立在愿意沟通之上，不逼迫、不纠缠。</li>
            <li>不伤害：任何形式的骚扰、威胁、仇恨与歧视都不被接受。</li>
            <li>不欺骗：不冒充他人，不用虚假身份获取信任。</li>
          </ul>
        </Section>

        <Section title="2. 禁止发布的内容">
          <ul className="ml-4 list-disc space-y-1">
            <li>
              辱骂、骚扰、威胁、跟踪他人，或持续纠缠；未经同意公开他人的隐私，例如住址、单位、
              联系方式、聊天记录截图。
            </li>
            <li>针对种族、民族、宗教、性别、性取向、身体残障等的仇恨或歧视内容。</li>
            <li>色情或露骨的性内容；任何与未成年人有关的性内容。</li>
            <li>宣扬暴力、自伤或自杀，或教唆违法与危险行为。</li>
            <li>
              垃圾信息与广告：批量私信、拉群、推广博彩、贷款、代充、刷单、虚拟币等。
            </li>
            <li>违法交易，以及恶意链接、诈骗或恶意软件。</li>
          </ul>
        </Section>

        <Section title="3. 禁止的行为">
          <ul className="ml-4 list-disc space-y-1">
            <li>批量注册账号、用脚本或机器人自动操作、爬取他人资料。</li>
            <li>绕过他人的可见范围设置或拉黑，换号继续骚扰。</li>
            <li>冒充他人或冒充官方，伪造身份与经历。</li>
            <li>买卖、出租、借用或共享账号。</li>
          </ul>
        </Section>

        <Section title="4. 举报与处理">
          <ul className="ml-4 list-disc space-y-1">
            <li>
              动态、评论、消息与用户都可以举报：请选择最贴近的理由，必要时补充说明。
              理由由服务端校验，不在列表内的理由会被拒绝。
            </li>
            <li>举报人的身份不会被透露给被举报人。</li>
            <li>
              我们可能采取的处理手段：提醒、下架或隐藏内容、限制部分功能、临时暂停账号
              （到期自动解除）、永久封禁账号。涉及真实威胁或违法内容的，直接封禁。
            </li>
            <li>处理结果会通知举报人，让举报的人知道后续如何。</li>
          </ul>
        </Section>

        <Section title="5. 如果你被处理了">
          <p>
            你可以通过【支持邮箱待填】申诉，并请说明你的账号与当时的情况，我们会复核。
            临时暂停的账号会在到期后自动恢复。
          </p>
        </Section>

        <Section title="6. 安全提示">
          <ul className="ml-4 list-disc space-y-1">
            <li>初次见面请选择公共场所，并把去向告诉朋友或家人。</li>
            <li>不要向刚认识的人转账、代付，也不要提供验证码或证件照片。</li>
            <li>遇到可疑行为请直接举报或拉黑，不必先与对方周旋。</li>
          </ul>
        </Section>

        <p className="mt-8 rounded-row bg-surface-sunken px-4 py-3 text-caption leading-5 text-content-muted">
          本规则是
          <Link href="/legal/terms" className="mx-1 font-medium text-brand-600">
            用户协议
          </Link>
          的一部分，也请阅读
          <Link href="/legal/privacy" className="mx-1 font-medium text-brand-600">
            隐私政策
          </Link>
          。
        </p>
      </div>
    </PhoneShell>
  );
}
