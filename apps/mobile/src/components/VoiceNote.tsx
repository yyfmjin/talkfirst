import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Icon } from "./Icon";
import { colors } from "../theme";
import { useI18n } from "../lib/i18n-context";

/**
 * 语音条（2026-10-28 重做：微信那种）。
 *
 * ## 为什么不是「播放器」
 *
 * 第一版是「圆形播放键 + 进度槽 + 00:06」—— 那是一个播放器控件，不是消息。
 * 微信的语音条是一个**气泡**：宽度随时长变长、里面只有喇叭图标和 `6″`，
 * 点一下播放、喇叭旁边三根声波跳。时长本身就是全部信息，不需要进度百分比。
 *
 * ## 宽度随时长走
 *
 * 1 秒最短、60 秒封顶 —— 长语音不该把整行撑满，短语音也不该缩成一个点。
 * 上限取 60 秒而不是录制上限（180 秒）：超过一分钟后宽度不再增长，否则
 * 3 分钟的语音会把卡片挤变形。
 *
 * ## 每个实例自带 player
 *
 * 卡片的数量在信息流里是有上限的（一页 20 条），而共享一个 player 需要在屏幕
 * 之间传递「当前播放的是哪一条」、并在滚动回收时手动对账 —— 那套状态比多几个
 * player 实例更容易出错。播放结束（didJustFinish）后再点会从头开始，而不是
 * 「点了没反应」。
 */
const MIN_WIDTH = 108;
const MAX_WIDTH = 236;
/** 宽度在这秒数上封顶。 */
const WIDTH_CAP_SECONDS = 60;

export function VoiceNote({
  uri,
  durationSec,
}: {
  uri: string;
  durationSec?: number | null;
}) {
  const { t } = useI18n();
  const player = useAudioPlayer({ uri }, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);

  const total = Math.max(
    1,
    Math.round(status.duration > 0 ? status.duration : (durationSec ?? 0)),
  );
  const playing = status.playing;

  function toggle() {
    if (playing) {
      player.pause();
      return;
    }
    if (status.didJustFinish || status.currentTime >= total) {
      void player.seekTo(0);
    }
    player.play();
  }

  const width = voiceBubbleWidth(total);

  return (
    <Pressable
      onPress={toggle}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityState={{ selected: playing }}
      accessibilityLabel={t(playing ? "moments.voicePause" : "moments.voicePlay")}
      style={[styles.bubble, { width }, playing ? styles.bubblePlaying : null]}
    >
      <Icon name="volume-medium" size={17} color={colors.primary} />
      <SoundWaves active={playing} />
      <Text style={styles.duration}>{formatVoiceDuration(total)}</Text>
    </Pressable>
  );
}

/** 三条声波：播放时错相位跳动，静止时平躺成三条淡淡的竖线。 */
function SoundWaves({ active }: { active: boolean }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, pulse]);

  return (
    <View
      style={styles.waves}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {WAVE_OPACITY.map((range, index) => (
        <Animated.View
          key={index}
          style={[
            styles.wave,
            { height: WAVE_HEIGHTS[index] },
            {
              opacity: active
                ? pulse.interpolate({ inputRange: [0, 1], outputRange: range })
                : 0.4,
            },
          ]}
        />
      ))}
    </View>
  );
}

const WAVE_HEIGHTS = [7, 13, 9];
/** 三根柱子错开相位，看起来才像声波而不是三根一起闪。 */
const WAVE_OPACITY: Array<[number, number]> = [
  [0.35, 1],
  [1, 0.35],
  [0.55, 0.95],
];

function voiceBubbleWidth(seconds: number) {
  const ratio = Math.min(WIDTH_CAP_SECONDS, Math.max(1, seconds)) / WIDTH_CAP_SECONDS;
  return Math.round(MIN_WIDTH + ratio * (MAX_WIDTH - MIN_WIDTH));
}

/**
 * 微信的写法：60 秒内是 `6″`，一分钟以上是 `1′05″`。
 *
 * 不显示「0:06」—— 那是播放器的读法，不是一条语音的读法。
 */
export function formatVoiceDuration(value: number) {
  const safe = Math.max(1, Math.round(value));
  if (safe < 60) return `${safe}″`;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return seconds === 0
    ? `${minutes}′`
    : `${minutes}′${String(seconds).padStart(2, "0")}″`;
}

const styles = StyleSheet.create({
  bubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: colors.bgSoft,
  },
  bubblePlaying: { backgroundColor: colors.bgTint },
  duration: { fontSize: 13, fontWeight: "600", color: colors.ink, marginLeft: "auto" },
  waves: { flexDirection: "row", alignItems: "center", gap: 2.5 },
  wave: { width: 2.5, borderRadius: 2, backgroundColor: colors.primary },
});
