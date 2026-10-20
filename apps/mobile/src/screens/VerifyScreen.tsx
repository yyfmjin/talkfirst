import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { KeyboardAware } from "../components/KeyboardAware";
import { Logo } from "../components/Logo";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { useI18n } from "../lib/i18n-context";
import type { SessionUser } from "../lib/types";
import { colors } from "../theme";

/**
 * 邮箱验证码。
 *
 * ## 为什么 App 必须有这一屏
 *
 * 线上开着 `ENFORCE_EMAIL_VERIFICATION=true`：未验证的账号**登录会被 403
 * `EMAIL_NOT_VERIFIED` 挡住**（见 `auth.service.ts` 的登录分支）。而 App 之前的
 * 注册流程是「邮箱 + 密码 → 直接进 App」—— 注册那一刻能拿到 token，一旦退出或
 * 换设备就**再也登不进来**，页面上也没有任何地方能填验证码。2026-10-20 实测：
 * 注册 201 → /users/me 200 → 重新登录 403。
 *
 * 所以验证屏不是「补个体验」，是把断掉的注册闭环接上。三种入口都通到这里：
 *
 *   1. 注册成功后（`AuthScreen` 立刻推上来）；
 *   2. 登录返回 `EMAIL_NOT_VERIFIED`（老账号第一次在 App 里登录）；
 *   3. 用户点「重新发送」。
 *
 * 进屏即自动发一次验证码：用户刚刚注册完，让他再点一次「发送」只是多余的一步；
 * 但重发有 60 秒冷却，避免连点把邮箱限流打满。
 */
const CODE_LENGTH = 6;
const RESEND_COOLDOWN_S = 60;

export function VerifyScreen({
  email,
  onVerified,
  onSkip,
}: {
  email: string;
  onVerified: () => void;
  onSkip?: () => void;
}) {
  const { setUser } = useAuth();
  const { t } = useI18n();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const autoSent = useRef(false);

  const sendCode = useCallback(async () => {
    setError("");
    setNotice("");
    try {
      await apiFetch("/auth/send-verification-code", { method: "POST", body: { email } });
      setNotice(t("auth.codeSent"));
      setCooldown(RESEND_COOLDOWN_S);
    } catch {
      setError(t("auth.codeSendFailed"));
    }
  }, [email, t]);

  /**
   * 进屏自动发一次。
   *
   * 用 ref 而不是 `[sendCode]` 做闸门：`t` 每次渲染都是新函数（见
   * `i18n-context` 的说明），把 `sendCode` 放进依赖会让这个 effect 每轮重跑 ——
   * 那正好会连发验证码。ref 只让它在挂载后真正跑一次。
   */
  useEffect(() => {
    if (autoSent.current) return;
    autoSent.current = true;
    void sendCode();
  }, [sendCode]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function submit() {
    const value = code.trim();
    if (!new RegExp(`^\\d{${CODE_LENGTH}}$`).test(value)) {
      setError(t("auth.verifyFailed"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiFetch("/auth/verify-email", { method: "POST", body: { email, code: value } });
      // 服务端已经把 emailVerified 翻过来了，本地缓存的那份 user 还是旧的 ——
      // 刷新一次，避免「刚验证完又被当成未验证」。
      const me = await apiFetch<SessionUser>("/users/me").catch(() => null);
      if (me) setUser(me);
      onVerified();
    } catch {
      setError(t("auth.verifyFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAware style={styles.root}>
      <View style={styles.inner}>
        <View style={styles.header}>
          <Logo size={56} />
          <Text style={styles.title}>{t("auth.verifyTitle")}</Text>
          <Text style={styles.subtitle}>{t("auth.verifyIntro", { email })}</Text>
        </View>

        <View style={styles.form}>
          <Input
            label={t("auth.codeLabel")}
            value={code}
            onChangeText={setCode}
            placeholder={t("auth.codePlaceholder")}
            keyboardType="numbers-and-punctuation"
            maxLength={CODE_LENGTH}
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

          <Button label={t("auth.verifySubmit")} onPress={() => void submit()} loading={busy} />

          <Pressable
            onPress={() => {
              if (cooldown > 0) return;
              void sendCode();
            }}
            accessibilityRole="button"
            accessibilityLabel={t("auth.resendCode")}
            accessibilityState={{ disabled: cooldown > 0 }}
            hitSlop={8}
            style={styles.resend}
          >
            <Text style={[styles.resendText, cooldown > 0 ? styles.resendDisabled : null]}>
              {cooldown > 0 ? `${t("auth.resendCode")}（${cooldown}s）` : t("auth.sendCode")}
            </Text>
          </Pressable>

          {onSkip ? (
            <Pressable
              onPress={onSkip}
              accessibilityRole="button"
              accessibilityLabel={t("auth.skipVerify")}
              hitSlop={8}
              style={styles.resend}
            >
              <Text style={styles.skipText}>{t("auth.skipVerify")}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </KeyboardAware>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1, justifyContent: "center", padding: 28 },
  header: { alignItems: "center", marginBottom: 32 },
  title: { fontSize: 24, fontWeight: "600", color: colors.ink, marginTop: 18 },
  subtitle: { fontSize: 13, color: colors.muted, marginTop: 8, textAlign: "center", lineHeight: 19 },
  form: { width: "100%" },
  notice: { color: colors.primaryDark, fontSize: 12, marginBottom: 10, lineHeight: 18 },
  error: { color: colors.danger, fontSize: 12, marginBottom: 10, lineHeight: 18 },
  resend: { alignSelf: "center", marginTop: 16, paddingVertical: 6 },
  resendText: { color: colors.primary, fontSize: 13, fontWeight: "600" },
  resendDisabled: { color: colors.muted },
  skipText: { color: colors.muted, fontSize: 13 },
});
