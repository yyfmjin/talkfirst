"use client";

import { useState } from "react";
import { Languages } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useT } from "@/lib/i18n/use-locale";

/**
 * 动态正文的「翻译」开关（2026-10-30），与手机端 `MomentTranslate` 同一套交互。
 *
 * ## 为什么接口是 `POST /moments/:id/translate`
 *
 * 服务端按 id 自己取正文，顺带复用 `getMoment` 的可见性规则。如果让客户端把正文
 * 发过去，这个接口就等于一个免费翻译代理 —— 任何登录用户都能拿它翻任意文本。
 *
 * ## 为什么这个组件要放在 `<Link>` 外面
 *
 * 信息流卡片的正文整块包在指向详情的 `<Link>` 里。把按钮放进去，点一下会先跳详情
 * 再触发翻译（同一个点击两个语义），语音条当初也是因为这个原因移到 Link 外面的。
 *
 * ## 收起 / 展开
 *
 * 译文压在原文下面会让卡片长一倍，而多数人只想扫一眼。所以默认收起原文展开译文
 * **并存**，再点回去；失败只说一句，不弹错误框。
 */
export function MomentTranslate({ momentId, content }: { momentId: string; content: string }) {
  const { t, locale } = useT();
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function toggle() {
    if (text) {
      setText(null);
      return;
    }
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const result = await apiFetch<{ text: string | null }>(`/moments/${momentId}/translate`, {
        method: "POST",
        body: { targetLang: locale === "en" ? "en" : "zh" },
      });
      if (result?.text) setText(result.text);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  /* 一句话以内（「好」「+1」、纯表情）翻出来没意义，按钮不出现。 */
  if (content.trim().length < 4) return null;

  return (
    <div className="px-5 pb-3">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={text !== null}
        aria-busy={busy}
        className="inline-flex items-center gap-1.5 text-caption font-semibold text-brand-600 transition-colors duration-instant hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
      >
        <Languages size={14} aria-hidden="true" />
        {text ? t("moments.translateHide") : t("moments.translate")}
      </button>

      {text ? (
        <p className="mt-2 border-l border-brand-500 pl-3 text-body leading-6 text-content">{text}</p>
      ) : null}
      {failed ? <p className="mt-1 text-caption text-danger-700">{t("moments.translateFailed")}</p> : null}
    </div>
  );
}
