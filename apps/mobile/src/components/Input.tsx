import { StyleSheet, Text, TextInput, View } from "react-native";
import { colors } from "../theme";

export function Input({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry = false,
  autoCapitalize = "none",
  keyboardType = "default",
  maxLength,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  keyboardType?: "default" | "email-address";
  maxLength?: number;
}) {
  // The visible label sits in a sibling <Text>, which a screen reader cannot
  // associate with the field on its own: TalkBack/VoiceOver announced it as an
  // unlabelled edit box. Bind them explicitly with nativeID +
  // accessibilityLabelledBy (the React Native equivalent of htmlFor), and keep
  // accessibilityLabel as the fallback for platforms/versions that do not
  // resolve the reference.
  const labelId = `input-label-${label.toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <View style={styles.field}>
      <Text style={styles.label} nativeID={labelId}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        keyboardType={keyboardType}
        maxLength={maxLength}
        accessibilityLabel={label}
        accessibilityLabelledBy={labelId}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 16 },
  label: { fontSize: 13, color: colors.ink, marginBottom: 8, fontWeight: "500" },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingHorizontal: 14,
    fontSize: 15,
    color: colors.ink,
    backgroundColor: colors.bg,
  },
});
