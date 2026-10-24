import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Icon } from "./Icon";
import { colors } from "../theme";

/**
 * 语音动态的播放条（2026-10-24）。
 *
 * 每个实例自己持有 player：卡片的数量在信息流里是有上限的（一页 20 条），
 * 而共享一个 player 需要在屏幕之间传递当前播放的是哪一条、并在滚动回收时
 * 手动对账 —— 那套状态比多几个 player 实例更容易出错。
 *
 * 播放结束（didJustFinish）后再点会从头开始，而不是「点了没反应」。
 */
export function VoiceNote({
  uri,
  durationSec,
}: {
  uri: string;
  durationSec?: number | null;
}) {
  const player = useAudioPlayer({ uri }, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);

  const total = Math.max(
    1,
    Math.round(status.duration > 0 ? status.duration : (durationSec ?? 0)),
  );
  const current = Math.min(total, Math.max(0, Math.round(status.currentTime)));
  const playing = status.playing;
  const progress = playing ? current / total : 0;

  function toggle() {
    if (playing) {
      player.pause();
      return;
    }
    if (status.didJustFinish || current >= total) {
      void player.seekTo(0);
    }
    player.play();
  }

  return (
    <Pressable
      onPress={toggle}
      accessibilityRole="button"
      accessibilityLabel={playing ? "pause" : "play"}
      style={styles.row}
    >
      <View style={styles.playCircle}>
        <Icon name={playing ? "pause" : "play"} size={16} color={colors.white} />
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.round(progress * 100)}%` }]} />
      </View>
      <Text style={styles.time}>{formatSeconds(playing ? current : total)}</Text>
    </Pressable>
  );
}

function formatSeconds(value: number) {
  const safe = Math.max(0, Math.round(value));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: colors.bgSoft,
  },
  playCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  track: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.line,
    overflow: "hidden",
  },
  fill: { height: 4, borderRadius: 2, backgroundColor: colors.primary },
  time: { fontSize: 13, color: colors.muted, minWidth: 38, textAlign: "right" },
});
