"use client";

import { useCallback, useEffect, useState } from "react";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { VisibilitySelect } from "@/components/visibility-select";
import {
  TFButton,
  TFCard,
  TFErrorState,
  TFLoadingRegion,
  TFSkeleton,
} from "@/components/tf";
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
        <p className="text-ui leading-6 text-content-muted">
          这里只控制个人资料的展示范围，不影响社交账号交换，也不影响动态的可见范围。
        </p>
        <p className="mt-2 rounded-row bg-surface-sunken px-3 py-2.5 text-caption leading-5 text-content-muted">
          拉黑始终优先于这里的设置：被拉黑的人看不到你的任何资料，包括设为「公开」的部分。
        </p>

        {loading ? (
          <TFLoadingRegion label="正在加载可见范围设置">
            <div className="mt-5 space-y-3">
              <TFSkeleton shape="block" className="h-56 w-full" />
              <TFSkeleton shape="block" className="h-24 w-full" />
            </div>
          </TFLoadingRegion>
        ) : null}

        {!loading && error ? (
          <div className="mt-5">
            <TFErrorState description={error} onRetry={() => void load()} />
          </div>
        ) : null}

        {/*
          One card per field. `visibility-row-{fieldKey}` is asserted by
          `profile.spec.ts` (it uses `visibility-row-bio`), and the ROW must
          contain the current tier's wording — the test reads 「仅好友/连接可见」
          from the row before changing it, and 「仅自己可见」 after a reload. Those
          strings come from `VISIBILITY_LABELS` and are unchanged.
        */}
        {!loading && rows.length > 0 ? (
          <div className="mt-5 space-y-3">
            {rows.map((row) => (
              <TFCard key={row.fieldKey} data-testid={`visibility-row-${row.fieldKey}`}>
                <p className="text-ui font-medium text-content">{FIELD_VISIBILITY_LABELS[row.fieldKey]}</p>
                <p className="mb-2.5 mt-0.5 text-caption text-content-muted">
                  当前：{VISIBILITY_LABELS[row.visibility]}
                </p>
                <VisibilitySelect
                  value={row.visibility}
                  disabled={savingField === row.fieldKey}
                  label={`${FIELD_VISIBILITY_LABELS[row.fieldKey]} 的可见范围`}
                  onChange={(tier) => void change(row.fieldKey, tier)}
                />
              </TFCard>
            ))}
          </div>
        ) : null}

        {notice ? (
          <p role="status" className="mt-4 text-center text-caption text-success-600">
            {notice}
          </p>
        ) : null}

        <div className="mt-6">
          <TFButton variant="secondary" fullWidth href="/me">
            返回我的
          </TFButton>
        </div>
      </div>
    </PhoneShell>
  );
}
