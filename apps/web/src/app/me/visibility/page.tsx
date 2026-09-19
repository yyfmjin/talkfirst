"use client";

import { useCallback, useEffect, useState } from "react";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { VisibilitySelect } from "@/components/visibility-select";
import { OutlineButton, SmallButton } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/errors";
import {
  FIELD_VISIBILITY_LABELS,
  VISIBILITY_LABELS,
  type FieldVisibilityRow,
  type VisibilityTier,
} from "@/lib/profile";

/**
 * PC-1.4 §11-§12: per-field profile visibility.
 *
 * The GET always returns all 13 whitelisted keys, so the screen never has to
 * invent a default. Setting a field back to 公开 is a normal API call — the
 * backend deletes its row, and the frontend does not need to know that.
 *
 * This governs the profile only. Social handles stay authorized by
 * `SharedSocialAccount`, and moment visibility by `MomentSetting.visibleTo`;
 * neither is touched here.
 */
export default function ProfileVisibilityPage() {
  const [rows, setRows] = useState<FieldVisibilityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [savingField, setSavingField] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<FieldVisibilityRow[]>("/users/me/profile-field-visibility");
      setRows(data);
    } catch (requestError) {
      setError(friendlyErrorMessage(requestError, "可见性设置加载失败，请稍后再试。"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function change(fieldKey: FieldVisibilityRow["fieldKey"], visibility: VisibilityTier) {
    setSavingField(fieldKey);
    setError("");
    setNotice("");
    try {
      const data = await apiFetch<FieldVisibilityRow[]>("/users/me/profile-field-visibility", {
        method: "PUT",
        body: { fieldKey, visibility },
      });
      setRows(data);
      setNotice(`「${FIELD_VISIBILITY_LABELS[fieldKey]}」已设为${VISIBILITY_LABELS[visibility]}。`);
    } catch (requestError) {
      setError(friendlyErrorMessage(requestError, "保存失败，请稍后再试。"));
      await load();
    } finally {
      setSavingField(null);
    }
  }

  return (
    <PhoneShell>
      <ScreenHeader title="资料可见范围" backHref="/me" />
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-4">
        <p className="text-[13px] leading-6 text-muted">
          这里只控制个人资料的展示范围，不影响社交账号交换，也不影响动态的可见范围。
        </p>
        <p className="mt-2 rounded-2xl bg-[#F8F9FF] px-3 py-2.5 text-[11px] leading-5 text-muted">
          拉黑始终优先于这里的设置：被拉黑的人看不到你的任何资料，包括设为「公开」的部分。
        </p>

        {loading ? (
          <div className="mt-5 animate-pulse space-y-3">
            <div className="h-56 rounded-3xl bg-indigo-50" />
            <div className="h-24 rounded-3xl bg-indigo-50" />
          </div>
        ) : null}

        {!loading && error ? (
          <div className="mt-5 rounded-2xl bg-red-50 p-4 text-center">
            <p className="text-[12px] text-red-700">{error}</p>
            <SmallButton className="mt-3 w-full" onClick={() => void load()}>
              重试
            </SmallButton>
          </div>
        ) : null}

        {!loading && rows.length > 0 ? (
          <div className="mt-5 space-y-3">
            {rows.map((row) => (
              <section
                key={row.fieldKey}
                data-testid={`visibility-row-${row.fieldKey}`}
                className="rounded-3xl border border-line bg-white p-4"
              >
                <p className="text-[13px] font-medium">{FIELD_VISIBILITY_LABELS[row.fieldKey]}</p>
                <p className="mb-2 mt-0.5 text-[11px] text-muted">
                  当前：{VISIBILITY_LABELS[row.visibility]}
                </p>
                <VisibilitySelect
                  value={row.visibility}
                  disabled={savingField === row.fieldKey}
                  label={`${FIELD_VISIBILITY_LABELS[row.fieldKey]} 的可见范围`}
                  onChange={(tier) => void change(row.fieldKey, tier)}
                />
              </section>
            ))}
          </div>
        ) : null}

        {notice ? <p className="mt-4 text-center text-[12px] text-emerald-600">{notice}</p> : null}

        <div className="mb-1 mt-6">
          <OutlineButton href="/me" className="min-h-[2.75rem] w-full text-[13px]">
            返回我的
          </OutlineButton>
        </div>
      </div>
    </PhoneShell>
  );
}
