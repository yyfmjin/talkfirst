"use client";

import { useState } from "react";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { Field, GradientButton } from "@/components/ui";
import { ApiRequestError, apiFetch } from "@/lib/api";

export default function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError("");
    setSuccess(false);
    if (!currentPassword) {
      setError("请输入当前密码。");
      return;
    }
    if (newPassword.length < 8) {
      setError("新密码至少 8 个字符。");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致。");
      return;
    }
    setLoading(true);
    try {
      await apiFetch("/auth/password", {
        method: "POST",
        body: { currentPassword, newPassword, confirmPassword },
      });
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : "修改失败，请稍后再试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <PhoneShell>
      <ScreenHeader title="修改密码" backHref="/me" />
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-6">
        <p className="mb-5 text-[12px] leading-5 text-muted">
          修改成功后，其他设备会被登出，需要重新登录。当前设备会保持登录状态。
        </p>
        <Field label="当前密码" type="password" value={currentPassword} onChange={setCurrentPassword} />
        <div className="mt-4">
          <Field label="新密码（8-72 字符）" type="password" value={newPassword} onChange={setNewPassword} />
        </div>
        <div className="mt-4">
          <Field label="确认新密码" type="password" value={confirmPassword} onChange={setConfirmPassword} />
        </div>

        {success ? <p className="mt-4 text-[12px] text-emerald-600">密码已修改。</p> : null}
        {error ? <p className="mt-4 text-[12px] text-red-500">{error}</p> : null}

        <div className="mt-8">
          <GradientButton onClick={handleSubmit} disabled={loading}>
            {loading ? "修改中…" : "确认修改"}
          </GradientButton>
        </div>
      </div>
    </PhoneShell>
  );
}
