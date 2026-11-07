import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { apiFetch, ApiRequestError } from "../lib/api";
import { useI18n } from "../lib/i18n-context";
import { Icon } from "../components/Icon";
import { ModalScrim } from "../components/ModalScrim";
import { colors, themed } from "../theme";

import { radii, sizes } from "../design/tokens";
/**
 * 猜猜看（2026-10-25）。
 *
 * 三个状态：出题 → 结果 → 次数用完。
 *
 * ## 为什么答案不提前知道
 *
 * `GET /discover/guess` 只返回三个候选，正确答案在服务端（`CountryGuess` 表）。
 * 客户端拿不到，也就无从「本地判卷」—— 这条是防作弊的地基。
 *
 * ## 为什么答完才扣次数
 *
 * 出题不扣、作答才扣：跳过的人不该被罚。扣除方式是在服务端写一条 `DiscoverView`，
 * 所以「今日剩余」和发现页始终是同一个数字（`onQuotaChange` 回传给调用方刷新）。
 */
type GuessOption = { code: string; name: string; flag: string | null };

type GuessRound = {
  roundId: string;
  photoUrl: string;
  options: GuessOption[];
  remaining: number;
  expiresAt: string;
};

type GuessAnswer = {
  correct: boolean;
  answer: GuessOption;
  target: { id: string; nickname: string | null };
  stat: { total: number; correct: number; accuracy: number } | null;
  remaining: number;
  helloState: "NONE" | "PENDING" | "CONNECTED";
};

export function GuessSheet({
  visible,
  onClose,
  onQuotaChange,
}: {
  visible: boolean;
  onClose: () => void;
  /** 次数变化时通知发现页刷新顶部那个数字，两边永远同一个值。 */
  onQuotaChange?: (remaining: number) => void;
}) {
  const { t } = useI18n();
  const [round, setRound] = useState<GuessRound | null>(null);
  const [answer, setAnswer] = useState<GuessAnswer | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  /**
   * 两种「没人可猜」（2026-10-25 服务端区分）：
   *   "pool"    池子是空的 —— 引导去邀请朋友，而不是甩一句「晚点再来」；
   *   "guessed" 池子里有人，但你 7 天内都猜过了 —— 明天再来。
   */
  const [emptyState, setEmptyState] = useState<"pool" | "guessed" | null>(null);
  const [error, setError] = useState("");
  const [sendingHello, setSendingHello] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setAnswer(null);
    setPicked(null);
    setExhausted(false);
    setEmptyState(null);
    try {
      const data = await apiFetch<GuessRound>("/discover/guess");
      setRound(data);
      onQuotaChange?.(data.remaining);
    } catch (requestError) {
      const code = requestError instanceof ApiRequestError ? requestError.code : undefined;
      if (code === "NO_QUOTA") {
        setExhausted(true);
      } else if (code === "NO_CANDIDATE") {
        setEmptyState("pool");
      } else if (code === "NO_CANDIDATE_LEFT") {
        setEmptyState("guessed");
      } else {
        setError(requestError instanceof Error ? requestError.message : t("guess.loadFailed"));
      }
    } finally {
      setLoading(false);
    }
  }, [onQuotaChange, t]);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  async function submit(option: GuessOption) {
    if (!round || answering || answer) return;
    setPicked(option.code);
    setAnswering(true);
    setError("");
    try {
      const data = await apiFetch<GuessAnswer>(`/discover/guess/${round.roundId}`, {
        method: "POST",
        body: { countryCode: option.code },
      });
      setAnswer(data);
      onQuotaChange?.(data.remaining);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("guess.answerFailed"));
      setPicked(null);
    } finally {
      setAnswering(false);
    }
  }

  async function sayHello() {
    if (!answer || sendingHello) return;
    setSendingHello(true);
    setError("");
    try {
      await apiFetch("/connections/requests", {
        method: "POST",
        body: { receiverId: answer.target.id, templateId: "language" },
      });
      setAnswer({ ...answer, helloState: "PENDING" });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("guess.helloFailed"));
    } finally {
      setSendingHello(false);
    }
  }

  const statLine =
    answer?.stat != null
      ? t("guess.stat", { percent: Math.round(answer.stat.accuracy * 100) })
      : null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <ModalScrim />
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={t("guess.close")} />
      <View style={styles.sheet}>
        <View style={styles.grabber} />

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : exhausted ? (
          <View style={styles.center}>
            <Text style={styles.emptyTitle}>{t("guess.exhaustedTitle")}</Text>
            <Text style={styles.emptyBody}>{t("guess.exhaustedBody")}</Text>
            <Pressable onPress={onClose} style={styles.primary} accessibilityRole="button">
              <Text style={styles.primaryLabel}>{t("guess.exhaustedCta")}</Text>
            </Pressable>
          </View>
        ) : emptyState === "pool" ? (
          <View style={styles.center}>
            <Text style={styles.emptyTitle}>{t("guess.poolEmptyTitle")}</Text>
            <Text style={styles.emptyBody}>{t("guess.poolEmptyBody")}</Text>
            <Pressable
              onPress={() =>
                void Share.share({ message: t("guess.shareText") }).catch(() => undefined)
              }
              style={styles.primary}
              accessibilityRole="button"
            >
              <Text style={styles.primaryLabel}>{t("guess.poolEmptyInvite")}</Text>
            </Pressable>
            <Pressable onPress={onClose} style={styles.secondary} accessibilityRole="button">
              <Text style={styles.secondaryLabel}>{t("guess.poolEmptyLater")}</Text>
            </Pressable>
          </View>
        ) : emptyState === "guessed" ? (
          <View style={styles.center}>
            <Text style={styles.emptyTitle}>{t("guess.allGuessedTitle")}</Text>
            <Text style={styles.emptyBody}>{t("guess.allGuessedBody")}</Text>
            <Pressable onPress={onClose} style={styles.primary} accessibilityRole="button">
              <Text style={styles.primaryLabel}>{t("guess.allGuessedOk")}</Text>
            </Pressable>
          </View>
        ) : round ? (
          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            {answer ? (
              <>
                <View style={styles.resultHead}>
                  <Image source={{ uri: round.photoUrl }} style={styles.thumb} />
                  <View style={styles.resultText}>
                    <Text style={[styles.verdict, answer.correct ? styles.verdictOk : null]}>
                      {answer.correct ? t("guess.correct") : t("guess.reveal")}
                    </Text>
                    <Text style={styles.answerLine}>
                      {answer.answer.flag ? `${answer.answer.flag} ` : ""}
                      {answer.answer.name}
                    </Text>
                    {statLine ? <Text style={styles.stat}>{statLine}</Text> : null}
                  </View>
                </View>

                <Pressable
                  onPress={() => void sayHello()}
                  disabled={sendingHello || answer.helloState !== "NONE"}
                  style={[
                    styles.primary,
                    answer.helloState !== "NONE" ? styles.primaryDone : null,
                  ]}
                  accessibilityRole="button"
                >
                  <Text style={styles.primaryLabel}>
                    {answer.helloState === "CONNECTED"
                      ? t("guess.helloConnected")
                      : answer.helloState === "PENDING"
                        ? t("guess.helloSent")
                        : sendingHello
                          ? t("guess.helloSending")
                          : t("guess.sayHello")}
                  </Text>
                </Pressable>

                <Pressable onPress={() => void load()} style={styles.secondary} accessibilityRole="button">
                  <Text style={styles.secondaryLabel}>{t("guess.again")}</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Image source={{ uri: round.photoUrl }} style={styles.photo} resizeMode="cover" />
                <Text style={styles.prompt}>{t("guess.prompt")}</Text>
                <Text style={styles.hint}>{t("guess.hint")}</Text>

                <View style={styles.options}>
                  {round.options.map((option) => {
                    const isPicked = picked === option.code;
                    return (
                      <Pressable
                        key={option.code}
                        onPress={() => void submit(option)}
                        disabled={answering}
                        accessibilityRole="button"
                        accessibilityLabel={option.name}
                        style={[styles.option, isPicked ? styles.optionPicked : null]}
                      >
                        <Text style={styles.optionFlag}>{option.flag ?? "🌐"}</Text>
                        <Text style={styles.optionName}>{option.name}</Text>
                        {isPicked && answering ? (
                          <ActivityIndicator size="small" color={colors.primary} />
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>

                <View style={styles.footerRow}>
                  <Text style={styles.remainingText}>{t("guess.remaining", { n: round.remaining })}</Text>
                  <Pressable onPress={() => void load()} disabled={answering} accessibilityRole="button">
                    <Text style={styles.ghost}>{t("guess.skip")}</Text>
                  </Pressable>
                </View>
              </>
            )}

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>
        ) : (
          <View style={styles.center}>
            <Text style={styles.emptyBody}>{error || t("guess.loadFailed")}</Text>
            <Pressable onPress={() => void load()} style={styles.primary} accessibilityRole="button">
              <Text style={styles.primaryLabel}>{t("guess.retry")}</Text>
            </Pressable>
          </View>
        )}

        <Pressable onPress={onClose} style={styles.closeButton} accessibilityLabel={t("guess.close")}>
          <Icon name="close" size={20} color={colors.muted} />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = themed((c) => StyleSheet.create({
  scrim: { flex: 1 },
  sheet: {
    /* 实底（2026-11-07）：原来是 glassRaised，背后的页面会透进弹层。 */
    backgroundColor: c.bgSolid,
    borderTopWidth: 1,
    borderColor: c.line,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingBottom: 26,
    paddingTop: 8,
    maxHeight: "92%",
  },
  grabber: {
    width: 38,
    height: 4,
    borderRadius: radii.chip,
    backgroundColor: c.line,
    alignSelf: "center",
    marginBottom: 12,
  },
  body: { paddingBottom: 8 },
  center: { alignItems: "center", justifyContent: "center", paddingVertical: 40, gap: 12 },
  photo: { width: "100%", aspectRatio: 4 / 5, borderRadius: radii.control, backgroundColor: c.bgSoft },
  prompt: { fontSize: sizes.heading, fontWeight: "600", color: c.ink, marginTop: 16 },
  hint: { fontSize: sizes.ui, color: c.muted, marginTop: 4, marginBottom: 12 },
  options: { gap: 8, marginTop: 4 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: radii.chip,
    paddingVertical: 13,
    paddingHorizontal: 14,
    backgroundColor: c.glass,
  },
  optionPicked: { borderColor: c.primary },
  optionFlag: { fontSize: sizes.title },
  optionName: { flex: 1, fontSize: sizes.body, color: c.ink, fontWeight: "500" },
  footerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 14 },
  remainingText: { fontSize: sizes.caption, color: c.muted },
  ghost: { fontSize: sizes.ui, color: c.muted, paddingVertical: 6 },
  resultHead: { flexDirection: "row", gap: 12, alignItems: "center", marginTop: 6 },
  thumb: { width: 88, height: 88, borderRadius: radii.chip, backgroundColor: c.bgSoft },
  resultText: { flex: 1, gap: 4 },
  verdict: { fontSize: sizes.body, fontWeight: "600", color: c.ink },
  verdictOk: { color: "#16A34A" },
  answerLine: { fontSize: sizes.body, color: c.ink },
  stat: { fontSize: sizes.caption, color: c.muted },
  primary: {
    marginTop: 16,
    backgroundColor: c.primary,
    borderRadius: radii.chip,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryDone: { backgroundColor: "#16A34A" },
  primaryLabel: { color: c.white, fontSize: sizes.body, fontWeight: "600" },
  secondary: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.glass,
    borderRadius: radii.chip,
    paddingVertical: 13,
    alignItems: "center",
  },
  secondaryLabel: { color: c.ink, fontSize: sizes.body, fontWeight: "500" },
  emptyTitle: { fontSize: sizes.body, fontWeight: "600", color: c.ink },
  emptyBody: { fontSize: sizes.ui, color: c.muted, textAlign: "center", lineHeight: 20, paddingHorizontal: 12 },
  error: { marginTop: 10, fontSize: sizes.ui, color: c.danger, textAlign: "center" },
  closeButton: { position: "absolute", top: 12, right: 14, padding: 6 },
}));
