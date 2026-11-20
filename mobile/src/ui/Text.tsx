import { forwardRef } from "react";
import { Text as RNText, TextInput as RNTextInput, type TextInputProps, type TextProps } from "react-native";
import { MAX_FONT_SCALE, usePalette } from "./theme";

/**
 * App text: theme colour by default and OS font scaling clamped to 1.1×.
 * (React 19 ignores `Text.defaultProps` on function components, so the clamp
 * lives here and every screen uses these instead of the RN primitives.)
 */
export function Text({ style, muted, ...props }: TextProps & { muted?: boolean }) {
  const c = usePalette();
  return (
    <RNText
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      {...props}
      style={[{ color: muted ? c.muted : c.text, fontSize: 15 }, style]}
    />
  );
}

export const TextInput = forwardRef<RNTextInput, TextInputProps>(function TextInput({ style, ...props }, ref) {
  const c = usePalette();
  return (
    <RNTextInput
      ref={ref}
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      placeholderTextColor={c.muted}
      selectionColor={c.primary}
      cursorColor={c.primary}
      {...props}
      style={[{ color: c.text, fontSize: 15 }, style]}
    />
  );
});
