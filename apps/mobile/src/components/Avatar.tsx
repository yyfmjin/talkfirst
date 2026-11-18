import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, themed } from "../theme";

/**
 * 头像（2026-11-13）。
 *
 * 新增 `onPress` 是为了把「点头像 = 看这个人是谁」变成一条能复用的规则：
 * 之前每个列表都得自己再包一层 Pressable，包着包着就有地方漏了，
 * 于是同一个头像在这屏能点、在那屏点不动。
 *
 * 点整行是另一件事（进聊天 / 进详情），由行自己接——头像只负责「这个人」。
 * 命中区往外放 6px：46px 的头像在列表里是手指最容易偏一点的目标。
 */
export function Avatar({
  uri,
  nickname,
  size = 56,
  onPress,
}: {
  uri: string | null;
  nickname: string | null;
  size?: number;
  /** 有传就变成可点：语义固定为「查看资料」。 */
  onPress?: () => void;
}) {
  const initial = (nickname ?? "?").slice(0, 1).toUpperCase();
  const radius = size / 2;

  const body = uri ? (
    <Image
      source={{ uri }}
      style={{ width: size, height: size, borderRadius: radius, backgroundColor: colors.bgTint }}
    />
  ) : (
    <View style={[styles.fallback, { width: size, height: size, borderRadius: radius }]}>
      <Text style={[styles.initial, { fontSize: size * 0.4 }]}>{initial}</Text>
    </View>
  );

  if (!onPress) return body;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={nickname ? `${nickname} · 查看资料` : "查看资料"}
      hitSlop={6}
    >
      {body}
    </Pressable>
  );
}

const styles = themed((c) => StyleSheet.create({
  fallback: {
    backgroundColor: c.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  initial: { color: c.white, fontWeight: "600" },
}));
