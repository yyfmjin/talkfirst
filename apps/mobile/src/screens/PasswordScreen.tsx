import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "../components/Button";
import { SubHeader } from "../components/SubHeader";
import { apiFetch, apiFetchEnvelope, ApiRequestError } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { useI18n } from "../lib/i18n-context";
import type { MsgKey } from "../lib/messages";
import { saveTokens } from "../lib/storage";
import type { AccountLoginMethods } from "../lib/types";
import { colors, themed } from "../theme";

import { radii, sizes } from "../design/tokens";
type Mode = "loading" | "set" | "change";

/**
 * 这个端点能回的错误码 → 本地文案键。没映射到的降级成 `me.saveFailed`，
 * 而不是把服务端的英文原句摆在中文界面里。
 */
const PASSWORD_ERROR_KEYS: Record<string, MsgKey> = {
  PASSWORD_MISMATCH: "me.passwordMismatch",
  PASSWORD_UNCHANGED: "me.passwordErrorUnchanged",
  INVALID_CREDENTIALS: "me.passwordErrorCurrent",
  VALIDATION_ERROR: "me.passwordErrorValidation",
  /*
   * 邮箱验证码（2026-11-11）。「错了」和「过期/锁了」对用户的下一步不再是同一件事
   * —— 前者重输，后者重发 —— 所以两种提示分开。
   */
  CODE_MISMATCH: "me.passwordErrorCode",
  CODE_INVALID: "me.passwordErrorCode",
  CODE_LOCKED: "me.passwordErrorCodeLocked",
  SERVICE_UNAVAILABLE: "me.passwordErrorService",
};

/**
 * 修改密码 —— 或给「只有 Google 登录、没有密码」的账号设置第一个密码。
 *
 * `GET /auth/oauth/me/methods` 的 `hasPassword` 决定走哪条：
 *  - 有密码 → 需要当前密码；
 *  - 没有 → 不渲染当前密码框，提交时 `currentPassword` 传 `-` 占位（服务端 DTO
 *    要求非空字符串，但该字段在这种账号上从头到尾不被读取）。
 *
 * `POST /auth/password` 会轮换 token 并把新 token 放在信封顶层 —— 和登录一样，
 * 必须用 `apiFetchEnvelope` 拿到并存进 SecureStore，否则当前设备的会话会失联。
 */
export function PasswordScreen({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  const { setUser } = useAuth();
  const [mode, setMode] = useState<Mode>("loading");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  /** 邮箱验证码（2026-11-11）：拿到码才能改密码，码由服务端发到账号邮箱。 */
  const [code, setCode] = useState("");
  const [sendingCode, setSendingCode] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [notice, setNotice] = useState("");

  // 重发冷却对齐服务端 60s/地址的预算，否则按钮只是在邀请一次必被拒的请求。
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    let alive = true;
    apiFetch<AccountLoginMethods>("/auth/oauth/me/methods")
      .then((methods) => {
        if (alive) setMode(methods.hasPassword ? "change" : "set");
      })
      .catch(() => {
        /* 读不到就退回「修改」方向：有密码的人不会被塞一个不用验证当前密码的表单。 */
        if (alive) {
          setMode("change");
          setError(t("me.passwordLoadFailed"));
        }
      });
    return () => {
      alive = false;
    };
  }, [t]);

  const settingFirstPassword = mode === "set";

  async function sendCode() {
    setError("");
    setNotice("");
    setSendingCode(true);
    try {
      /**
       * 不传收件人：服务端取当前会话的邮箱。手机端因此连「知道是哪个邮箱」都不需要
       * —— 也就无法被用来给任意地址发信。
       */
      await apiFetch("/auth/password/verification-code", { method: "POST" });
      setNotice(t("me.passwordCodeSent"));
      setCooldown(60);
    } catch (requestError) {
      setError(
        requestError instanceof ApiRequestError && requestError.code === "SERVICE_UNAVAILABLE"
          ? t("me.passwordErrorService")
          : t("me.passwordErrorSend"),
      );
    } finally {
      setSendingCode(false);
    }
  }

  async function submit() {
    if (!settingFirstPassword && !currentPassword) {
      setError(t("me.passwordCurrentRequired"));
      return;
    }
    if (newPassword.length < 8) {
      setError(t("me.passwordTooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("me.passwordMismatch"));
      return;
    }
    // 客户端只卡「填没填」，对错交给服务端 —— 但它必须先拦一道，不然用户会白跑一次。
    if (!/^\d{6}$/.test(code.trim())) {
      setError(t("me.passwordCodeRequired"));
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const session = await apiFetchEnvelope("/auth/password", {
        method: "POST",
        body: {
          currentPassword: settingFirstPassword ? "-" : currentPassword,
          newPassword,
          confirmPassword,
          code: code.trim(),
        },
      });
      await saveTokens(session.accessToken, session.refreshToken);
      setUser(session.data);
      setMode("change");
      setSuccess(settingFirstPassword ? t("me.passwordSetSuccess") : t("me.passwordChanged"));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      // 码已服务端消耗，留着只会让人以为还能再用。
      setCode("");
      setNotice("");
      setCooldown(0);
    } catch (requestError) {
      if (requestError instanceof ApiRequestError) {
        const key = PASSWORD_ERROR_KEYS[requestError.code];
        setError(key ? t(key) : t("me.saveFailed"));
      } else {
        setError(t("me.saveFailed"));
      }
    } finally {
      setSaving(false);
    }
  }

  if (mode === "loading") {
    return (
      <View style={styles.root}>
        <SubHeader title={t("me.password")} onBack={onBack} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <SubHeader title={settingFirstPassword ? t("me.passwordSet") : t("me.password")} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>
          {settingFirstPassword ? t("me.passwordSetHint") : t("me.passwordChangeHint")}
        </Text>

        {settingFirstPassword ? null : (
          <PasswordField
            label={t("me.passwordCurrent")}
            value={currentPassword}
            onChange={setCurrentPassword}
          />
        )}

        <PasswordField
          label={settingFirstPassword ? t("me.passwordNewSet") : t("me.passwordNew")}
          value={newPassword}
          onChange={setNewPassword}
        />

        <PasswordField
          label={t("me.passwordConfirm")}
          value={confirmPassword}
          onChange={setConfirmPassword}
        />

        {/* 邮箱验证码（2026-11-11）。放在表单末尾：密码是用户现在就能填的，码要等一封信。 */}
        <View style={styles.field}>
          <View style={styles.codeHeader}>
            <Text style={styles.fieldLabel}>{t("me.passwordCode")}</Text>
            <Pressable
              onPress={() => void sendCode()}
              disabled={sendingCode || cooldown > 0}
              accessibilityRole="button"
              accessibilityState={{ disabled: sendingCode || cooldown > 0 }}
              hitSlop={8}
            >
              <Text
                style={[
                  styles.codeAction,
                  (sendingCode || cooldown > 0) && styles.codeActionDisabled,
                ]}
              >
                {sendingCode
                  ? `${t("me.passwordSendCode")}…`
                  : cooldown > 0
                    ? `${t("me.passwordSendCode")}（${cooldown}s）`
                    : t("me.passwordSendCode")}
              </Text>
            </Pressable>
          </View>
          <TextInput
            value={code}
            onChangeText={(next) => setCode(next.replace(/\D/g, "").slice(0, 6))}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            maxLength={6}
            placeholder={t("me.passwordCodePlaceholder")}
            accessibilityLabel={t("me.passwordCode")}
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <Text style={styles.codeHint}>{t("me.passwordCodeHint")}</Text>
          {notice ? <Text style={styles.okText}>{notice}</Text> : null}
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {success ? <Text style={styles.okText}>{success}</Text> : null}

        <View style={styles.actions}>
          {saving ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Button label={t("me.save")} onPress={() => void submit()} />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function PasswordField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        secureTextEntry
        autoCapitalize="none"
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
    </View>
  );
}

const styles = themed((c) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  body: { padding: 20, paddingBottom: 40, gap: 16 },
  hint: { fontSize: sizes.ui, lineHeight: 20, color: c.muted },
  field: { gap: 6 },
  fieldLabel: { fontSize: sizes.ui, fontWeight: "600", color: c.muted },
  input: {
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: radii.chip,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: sizes.body,
    color: c.ink,
    backgroundColor: c.glass,
  },
  codeHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  codeAction: { fontSize: sizes.ui, fontWeight: "600", color: c.primary },
  codeActionDisabled: { color: c.muted },
  codeHint: { fontSize: sizes.caption, lineHeight: 17, color: c.muted },
  errorText: { fontSize: sizes.ui, color: c.danger },
  okText: { fontSize: sizes.ui, color: c.primary },
  actions: { marginTop: 4 },
}));
