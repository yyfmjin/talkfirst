"use client";

import Link from "next/link";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";

/**
 * 用户协议（公开可读）。
 *
 * ## 为什么这一页必须存在
 *
 * `/legal` 是注册前的同意闸门，它让人勾选「我已阅读并同意用户协议」，
 * 并声称「两项都会在注册流程中提供完整文本」。在此之前**只有隐私政策**有正文，
 * 用户协议没有页面 —— 让人同意一份读不到的文件，等于没有同意。
 * （该页自身的注释里已经写过这条判断，这里是把缺的那一半补上。）
 *
 * ## DRAFT — needs review before launch
 *
 * 与 `/legal/privacy` 同一处境：文本由工程师起草，不是法律意见。
 * **事实部分**逐条对照实现写过 —— 年龄限制、用户名与昵称的区别、
 * 密码的存储方式（不可逆哈希）、Google 登录无密码、注销后发生什么、
 * 违规处理有哪些手段，都能在代码与 `docs/P0-01-*` / `docs/P0-04-*` 里找到对应。
 * **但有两处只有运营方能提供**，页面上以【】标出：
 * 运营主体与联系方式、适用法律与管辖地。填入之前，这两页不应被当作已生效的
 * 法律文件对外依赖（见 `docs/LEGAL-TEXTS.md`）。
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

export default function TermsPage() {
  return (
    <PhoneShell>
      <ScreenHeader title="用户协议" backHref="/legal" />
      <div className="tf-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-10 pt-4">
        <p className="text-caption text-content-subtle">最近更新：2026 年 10 月</p>

        <p className="mt-4 text-ui leading-6 text-content-muted">
          这份协议说明你与 TalkFirst 之间的规则：你可以用这个产品做什么、我们会对你的内容做什么、
          出现问题时怎么处理。请连同《隐私政策》与《社区规则》一起阅读。
        </p>

        <Section title="1. 关于本协议">
          <p>
            本协议适用于 TalkFirst 的手机应用与网站。本产品由
            【运营主体名称待填】运营，联系方式【支持邮箱待填】。
          </p>
          <p>如果你不同意本协议，请不要注册或继续使用本产品。</p>
        </Section>

        <Section title="2. 使用资格">
          <ul className="ml-4 list-disc space-y-1">
            <li>本产品仅限 18 岁以上使用。注册即表示你确认自己已满 18 岁。</li>
            <li>一个邮箱对应一个账号，请勿代人注册或批量注册。</li>
            <li>请提供真实可用的邮箱地址，它用于登录、找回密码与安全提醒。</li>
          </ul>
        </Section>

        <Section title="3. 账号与登录">
          <ul className="ml-4 list-disc space-y-1">
            <li>
              注册时你会得到一个用户名，用于登录；昵称是展示给别人看
              的名字，两者可以不同。
            </li>
            <li>
              密码由你设置并保管。我们以不可逆的哈希形式存储密码，
              <strong className="text-content">无法读回原文</strong>
              ；如果忘记，只能通过邮箱重置。
            </li>
            <li>
              你也可以选择用 Google 账号登录或注册。这样创建的账号没有密码，
              你可以在之后自行设置一个。
            </li>
            <li>请勿把账号转借、出租或出售。账号下发生的行为视为你本人的行为。</li>
          </ul>
        </Section>

        <Section title="4. 你的内容">
          <ul className="ml-4 list-disc space-y-1">
            <li>你发布的动态、评论、消息、头像与个人介绍，著作权仍归你所有。</li>
            <li>
              为提供服务所必需，你授予我们在产品内存储、展示并按你的可见范围设置
              向其他用户分发这些内容的许可。你调整可见范围或删除内容后，我们按新设置执行。
            </li>
            <li>你需保证自己有权发布这些内容，且内容不违反法律与《社区规则》。</li>
            <li>
              私聊内容只有会话参与者可见。请不要在未取得对方同意的情况下，
              把私聊内容转发或公开。
            </li>
          </ul>
        </Section>

        <Section title="5. 服务">
          <p>
            我们提供个人资料展示、发现与连接、动态、聊天与通知等功能，
            并可能调整、增加或停止其中部分功能。产品目前免费提供；
            如将来引入收费功能，会另行征求你的同意。
          </p>
          <p>
            产品按「现状」提供。我们会尽力保持它可用与安全，但无法保证服务永不中断、
            永不出现错误。
          </p>
        </Section>

        <Section title="6. 违规与处理">
          <p>
            你需要遵守《社区规则》。违反时我们可能：提醒、下架或隐藏内容、限制部分功能、
            临时暂停账号（到期自动解除）、或永久封禁账号。情节严重的，例如涉及真实威胁
            或违法内容，会直接封禁。
          </p>
          <p>
            你可以举报动态、评论、消息或用户。我们会把处理结果通知给举报人，
            并且不会向被举报人透露是谁举报的。
          </p>
        </Section>

        <Section title="7. 注销与终止">
          <ul className="ml-4 list-disc space-y-1">
            <li>
              你可以在「我的」里随时注销账号。注销后，我们按《隐私政策》在合理期限内
              删除你的个人资料及其关联内容。
            </li>
            <li>
              为安全审计所必需的记录会在《隐私政策》写明的期限内保留，
              不会随注销立即消失。
            </li>
            <li>
              如果你严重违反本协议或法律，我们可能中止或终止向你提供服务。
            </li>
          </ul>
        </Section>

        <Section title="8. 责任范围">
          <ul className="ml-4 list-disc space-y-1">
            <li>
              请自行判断与他人的交往。在法律允许的范围内，我们不对你与其他用户之间的
              纠纷负责。
            </li>
            <li>
              我们不对因不可抗力、第三方服务中断（例如你使用 Google 登录时的 Google 服务）、
              或你自身设备与网络问题造成的损失负责。
            </li>
            <li>【本条的责任限制范围需由法务确认】</li>
          </ul>
        </Section>

        <Section title="9. 协议变更">
          <p>
            本协议如有实质性变更，我们会在应用内提示。继续使用即表示你接受更新后的协议；
            若不同意，你可以停止使用并注销账号。
          </p>
        </Section>

        <Section title="10. 适用法律与争议解决">
          <p>【适用法律与管辖地待填】。填入之前，本条的效力需由法务确认。</p>
        </Section>

        <p className="mt-8 rounded-row bg-surface-sunken px-4 py-3 text-caption leading-5 text-content-muted">
          另外请阅读
          <Link href="/legal/privacy" className="mx-1 font-medium text-brand-600">
            隐私政策
          </Link>
          与
          <Link href="/legal/rules" className="mx-1 font-medium text-brand-600">
            社区规则
          </Link>
          。
        </p>
      </div>
    </PhoneShell>
  );
}
