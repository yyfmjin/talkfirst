import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { KeyboardAware } from "../components/KeyboardAware";
import { Logo } from "../components/Logo";
import { ApiRequestError, apiFetch } from "../lib/api";
import { useBackHandler } from "../lib/back-stack";
import { useI18n } from "../lib/i18n-context";
import { colors } from "../theme";

/**
 * 找回密码（对齐网页 `/reset`）。
 *
 * 网页早就有这条路径，App 之前没有 —— 用户在 App 里忘了密码，唯一的出路是去浏览器。
 * 接口完全复用：`POST /auth/password/forgot` 发码、`POST /auth/password/reset`
 * 带 `{ email, code, newPassword }` 重置。
 *
 * 两个细节照抄网页，不自己发明：
 *
 *   1. 「验证码已发送」的文案不承诺「找到了这个邮箱」—— 服务端对任何地址都回同一个
 *      结果（防枚举），界面不能说漏。
 *   2. `CODE_LOCKED` 单独说人话：那意味着这个码已经错太多次，只能重新要一个，
 *      而不是「再试一遍」。
 */
const CODE_LENGTH = 6;
const PASSWORD_MIN_LENGTH = 8;

export function ResetPasswordScreen({ initialEmail = "", onBack }: { initialEmail?: string; onBack: () => void }) {
  const { t } = useI18n();
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  /* 全屏子屏，必须自己接管返回键：不注册就会退出 App 回桌面。 */
  useBackHandler(true, onBack);

  /* 重发冷却每秒减一 —— 以前只赋值不递减，按钮会永久禁用。 */
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const normalized = email.trim().toLowerCase();
  const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);

  async function sendCode() {
    setError("");
    setNotice("");
    if (!emailLooksValid) {
      setError(t("reset.errEmail"));
      return;
    }
    setSending(true);
    try {
      await apiFetch("/auth/password/forgot", { method: "POST", body: { email: normalized } });
      setNotice(t("reset.sent"));
      setCooldown(60);
    } catch {
      setError(t("reset.errSubmit"));
    } finally {
      setSending(false);
    }
  }

  async function submit() {
    setError("");
    if (!emailLooksValid) return setError(t("reset.errEmail"));
    if (!new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code.trim())) return setError(t("reset.errCode"));
    if (password.length < PASSWORD_MIN_LENGTH) return setError(t("reset.errPassword"));
    if (password !== confirm) return setError(t("reset.errMismatch"));

    setSubmitting(true);
    try {
      await apiFetch("/auth/password/reset", {
        method: "POST",
        body: { email: normalized, code: code.trim(), newPassword: password },
      });
      setDone(true);
    } catch (requestError) {
      if (requestError instanceof ApiRequestError && requestError.code === "CODE_LOCKED") {
        setError(t("reset.errLocked"));
      } else {
        setError(t("reset.errSubmit"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAware style={styles.root}>
      <View style={styles.inner}>
        <View style={styles.header}>
          <Logo size={56} />
          <Text style={styles.title}>{t("reset.title")}</Text>
          <Text style={styles.subtitle}>{done ? t("reset.done") : t("reset.intro")}</Text>
        </View>

        {done ? (
          <View>
            <Button label={t("reset.backToLogin")} onPress={onBack} />
          </View>
        ) : (
          <View style={styles.form}>
            <Input
              label={t("reset.email")}
              value={email}
              onChangeText={setEmail}
              placeholder={t("auth.emailPlaceholder")}
              keyboardType="email-address"
              maxLength={254}
            />
            <Input
              label={t("reset.code")}
              value={code}
              onChangeText={setCode}
              placeholder={t("auth.codePlaceholder")}
              keyboardType="numbers-and-punctuation"
              maxLength={CODE_LENGTH}
            />
            <Input
              label={t("reset.newPassword")}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              maxLength={72}
            />
            <Input
              label={t("reset.confirmPassword")}
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry
              maxLength={72}
            />

            {notice ? (
              <Text style={styles.notice} accessibilityLiveRegion="polite">
                {notice}
              </Text>
            ) : null}
            {error ? (
              <Text style={styles.error} accessibilityLiveRegion="polite" accessibilityRole="alert">
                {error}
              </Text>
            ) : null}

            <Button
              label={cooldown > 0 ? `${t("reset.send")}（${cooldown}s）` : t("reset.send")}
              onPress={() => {
                if (cooldown > 0) return;
                void sendCode();
              }}
              loading={sending}
              disabled={cooldown > 0}
              variant="ghost"
            />
            <View style={styles.gap} />
            <Button label={t("reset.submit")} onPress={() => void submit()} loading={submitting} />
          </View>
        )}

        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={t("reset.backToLogin")}
          hitSlop={10}
          style={styles.back}
        >
          <Text style={styles.backText}>{t("reset.backToLogin")}</Text>
        </Pressable>
      </View>
    </KeyboardAware>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1, justifyContent: "center", padding: 28 },
  header: { alignItems: "center", marginBottom: 24 },
  title: { fontSize: 24, fontWeight: "600", color: colors.ink, marginTop: 18 },
  subtitle: { fontSize: 13, color: colors.muted, marginTop: 8, textAlign: "center", lineHeight: 19 },
  form: { width: "100%" },
  notice: { color: colors.primaryDark, fontSize: 12, marginBottom: 10, lineHeight: 18 },
  error: { color: colors.danger, fontSize: 12, marginBottom: 10, lineHeight: 18 },
  gap: { height: 10 },
  back: { alignSelf: "center", marginTop: 22, paddingVertical: 6 },
  backText: { color: colors.muted, fontSize: 13 },
});
