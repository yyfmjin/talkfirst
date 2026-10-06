"use client";

import Link from "next/link";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";

/**
 * 隐私政策（公开可读）。
 *
 * ## Why this page exists separately from `/legal`
 *
 * `/legal` is the registration consent gate — two checkboxes and a continue
 * button. That is not a privacy policy, and **Google's OAuth consent screen
 * requires a publicly reachable privacy-policy URL** that it will actually
 * check. Shipping only the checkbox gate is what makes "使用 Google 登录" fail
 * review, so the text lives here at its own address.
 *
 * ## DRAFT — needs review before launch
 *
 * The wording below is drafted by an engineer, not a lawyer. It is deliberately
 * specific about *what data* third-party sign-in receives, because that is the
 * part Google checks and the part a member would want to know. **It must be
 * reviewed (and localised, if the product targets more than one jurisdiction)
 * before this is relied on.** Everything factual in it — which fields, which
 * providers, what is stored — is accurate as implemented; the legal framing is
 * not a legal opinion.
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

export default function PrivacyPolicyPage() {
  return (
    <PhoneShell>
      <ScreenHeader title="隐私政策" backHref="/legal" />
      <div className="tf-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-10 pt-4">
        <p className="text-caption text-content-subtle">最近更新：2026 年 10 月</p>

        <p className="mt-4 text-ui leading-6 text-content-muted">
          TalkFirst 是一个帮助你先聊天、再决定是否成为朋友的产品。这份政策说明我们收集哪些资料、
          为什么收集、如何使用，以及你如何查看、更正或删除它们。
        </p>

        <Section title="1. 我们收集什么">
          <p>
            <strong className="text-content">你直接提供的：</strong>
            邮箱地址、密码（以不可逆的哈希形式存储，我们无法读回原文）、昵称、头像、出生日期、
            国家与城市、性别、个人介绍、语言、兴趣与交友目的。
          </p>
          <p>
            <strong className="text-content">你使用时产生的：</strong>
            你发布的动态与评论、点赞、连接与聊天消息、举报与屏蔽记录。
          </p>
          <p>
            <strong className="text-content">为安全与稳定所必需的技术记录：</strong>
            请求时间、请求路径、响应状态、错误码、IP 地址、浏览器标识（即
            <code className="mx-1">User-Agent</code>
            请求头）、设备标识（由该标识加盐哈希得到，不含你的姓名或邮箱）。
            这些记录用于排查故障、识别暴力破解与滥用。我们
            <strong className="text-content">不会</strong>把它们用于广告。
          </p>
        </Section>

        <Section title="2. 使用 Google 账号登录时，我们会收到什么">
          <p>
            你可以选择使用 Google 账号登录或注册。选择这样做时，Google 会向我们确认你的身份，
            我们<strong className="text-content">只会</strong>收到并存储以下几项：
          </p>
          <ul className="ml-4 list-disc space-y-1">
            <li>
              你在 Google 侧的<strong className="text-content">唯一标识符</strong>
              （<code>sub</code>），用于把这次登录对应到同一个账号；
            </li>
            <li>
              你的<strong className="text-content">邮箱地址</strong>，以及
              <strong className="text-content">该地址是否已通过 Google 验证</strong>；
            </li>
            <li>
              你的<strong className="text-content">昵称与头像</strong>（若你授权提供），
              用作初始资料，你随时可以在「我的」里修改。
            </li>
          </ul>
          <p>
            我们请求的权限范围<b>仅限基础账号信息</b>三项——用户标识、邮箱地址与基本资料。
            我们<strong className="text-content">不会</strong>、也无法访问你的邮箱正文、云端文件、
            日历、通讯录或任何其他 Google 服务中的数据，
            并且<strong className="text-content">永远不会收到你的 Google 密码</strong>。
          </p>
          <p>
            通过 Google 登录创建的账号<strong className="text-content">没有密码</strong>。
            如果你希望之后能改用邮箱密码登录，可以在账号设置中设置一个密码。
          </p>
          <p>
            如果 Google 交付给我们的是一个中继或代理邮箱地址（而不是你的真实邮箱），
            我们按收到的地址存储与显示，用途不变，也不会把它提供给第三方。
          </p>
        </Section>

        <Section title="3. 我们如何使用这些资料">
          <ul className="ml-4 list-disc space-y-1">
            <li>提供账号、登录、资料展示、动态、连接与聊天功能；</li>
            <li>按你的可见范围设置，决定谁能看到你的哪些资料；</li>
            <li>识别并阻止滥用、暴力破解、垃圾信息与违规内容；</li>
            <li>在你同意时发送必要的账号通知（如安全提醒）。</li>
          </ul>
          <p>我们不会出售你的个人资料，也不会将其用于第三方广告投放。</p>
        </Section>

        <Section title="4. 资料的可见范围">
          <p>
            个人资料的每个字段都可以单独设置可见范围（公开 / 仅连接 / 仅自己），
            你可以在「我的 → 隐私与安全」中调整。动态另有独立的可见范围设置。
            聊天内容只有会话参与者可见。
          </p>
        </Section>

        <Section title="5. 第三方">
          <p>
            除 Google（仅在你主动选择用 Google 登录时）之外，我们不会把你的个人资料提供给第三方，
            除非法律要求或为保护用户安全所必需。用于发送邮件验证码的邮件服务商仅在投递所需范围内
            处理你的邮箱地址。
          </p>
        </Section>

        <Section title="6. 保存期限">
          <p>
            账号存续期间保存你的资料。安全审计记录按固定期限自动清理
            （访问记录默认 30 天，安全事件默认 180 天），
            <strong className="text-content">删除账号后审计记录仍会保留</strong>
            ——因为审计的意义正在于记录发生过的事，这部分不随账号删除而消失。
          </p>
        </Section>

        <Section title="7. 你的权利">
          <p>
            你可以随时查看与更正自己的资料，调整可见范围，或注销账号。注销后我们会在合理期限内
            删除你的个人资料及其关联内容。若你认为我们处理你资料的方式有问题，可以通过应用内的
            举报入口或支持邮箱联系我们。
          </p>
        </Section>

        <Section title="8. 年龄">
          <p>本产品仅限 18 岁以上用户使用。我们不面向未成年人收集资料。</p>
        </Section>

        <Section title="9. 变更">
          <p>本政策若有实质性变更，我们会在应用内提示。继续使用即表示你接受更新后的政策。</p>
        </Section>

        <p className="mt-8 rounded-row bg-surface-sunken px-4 py-3 text-caption leading-5 text-content-muted">
          另外请阅读
          <Link href="/legal/terms" className="mx-1 font-medium text-brand-600">
            用户协议
          </Link>
          中的账号规则，以及
          <Link href="/legal/rules" className="mx-1 font-medium text-brand-600">
            社区规则
          </Link>
          。
        </p>
      </div>
    </PhoneShell>
  );
}
