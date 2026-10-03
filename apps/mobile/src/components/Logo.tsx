import { StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";

export function Logo({ size = 56 }: { size?: number }) {
  return (
    <View
      style={[
        styles.mark,
        { width: size, height: size, borderRadius: size * 0.28 },
      ]}
    >
      <Text style={{ color: colors.white, fontSize: size * 0.36, fontWeight: "700" }}>T</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
});
