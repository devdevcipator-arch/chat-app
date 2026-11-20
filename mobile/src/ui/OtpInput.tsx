import { useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput as RNTextInput, View } from "react-native";
import { Text, TextInput } from "./Text";
import { usePalette } from "./theme";

/**
 * Segmented numeric code input. One invisible TextInput drives the boxes, so
 * typing, backspace, OS one-time-code autofill and paste all behave natively.
 */
export function OtpInput({
  length,
  value,
  onChange,
  onComplete,
  disabled,
  error,
}: {
  length: number;
  value: string;
  onChange: (code: string) => void;
  onComplete: (code: string) => void;
  disabled?: boolean;
  error?: boolean;
}) {
  const c = usePalette();
  const input = useRef<RNTextInput>(null);
  const [focused, setFocused] = useState(true);

  const set = (text: string) => {
    const code = text.replace(/\D/g, "").slice(0, length);
    onChange(code);
    if (code.length === length) onComplete(code);
  };

  return (
    <Pressable onPress={() => input.current?.focus()} disabled={disabled} accessibilityLabel="Verification code">
      <View style={styles.row}>
        {Array.from({ length }, (_, i) => {
          const active = focused && (i === value.length || (i === length - 1 && value.length === length));
          return (
            <View
              key={i}
              style={[
                styles.box,
                {
                  backgroundColor: c.surface,
                  borderColor: error ? c.error : active ? c.primary : c.border,
                  borderWidth: active ? 2 : 1,
                },
              ]}
            >
              <Text style={styles.digit} allowFontScaling={false}>
                {value[i] ?? ""}
              </Text>
            </View>
          );
        })}
      </View>
      <TextInput
        ref={input}
        value={value}
        onChangeText={set}
        editable={!disabled}
        autoFocus
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={length}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        caretHidden
        style={styles.hidden}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8 },
  box: { flex: 1, height: 56, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  digit: { fontSize: 24, fontWeight: "600", fontVariant: ["tabular-nums"] },
  hidden: { position: "absolute", width: "100%", height: "100%", opacity: 0 },
});
