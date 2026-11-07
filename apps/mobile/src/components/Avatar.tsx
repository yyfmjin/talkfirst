import { Image, StyleSheet, Text, View } from "react-native";
import { colors, themed } from "../theme";

export function Avatar({
  uri,
  nickname,
  size = 56,
}: {
  uri: string | null;
  nickname: string | null;
  size?: number;
}) {
  const initial = (nickname ?? "?").slice(0, 1).toUpperCase();
  const radius = size / 2;

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: colors.bgTint }}
      />
    );
  }

  return (
    <View
      style={[
        styles.fallback,
        { width: size, height: size, borderRadius: radius },
      ]}
    >
      <Text style={[styles.initial, { fontSize: size * 0.4 }]}>{initial}</Text>
    </View>
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
