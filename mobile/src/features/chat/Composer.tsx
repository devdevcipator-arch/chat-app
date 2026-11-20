import { type ReactNode, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Config } from "../../lib/config";
import { evaluateMath, parseMathCommand } from "../../lib/math";
import { IconButton } from "../../ui/components";
import { Text, TextInput, type TextInputRef } from "../../ui/Text";
import { usePalette, useScale } from "../../ui/theme";

const isMathCommand = (text: string) => /^\/math(\s|$)/i.test(text.trim());

export function Composer({
  onSend,
  onSendMath,
  onNotice,
  onAttach,
  onRecord,
}: {
  onSend: (text: string) => void;
  /** A valid `/math` command, already evaluated. */
  onSendMath: (expression: string, formatted: string) => void;
  onNotice: (message: string) => void;
  onAttach: () => void;
  onRecord: () => void;
}) {
  const c = usePalette();
  const { s } = useScale();
  const [text, setText] = useState("");
  const input = useRef<TextInputRef>(null);
  const empty = text.trim().length === 0;

  const submit = () => {
    const content = text.trim();
    if (!content) return;
    if (isMathCommand(content)) {
      // Never send a broken command as text.
      const cmd = parseMathCommand(content);
      if (cmd?.kind !== "expression") return onNotice("Invalid math expression");
      const result = evaluateMath(cmd.expression);
      if (!result.ok) return onNotice(`Invalid math expression: ${result.error}`);
      onSendMath(cmd.expression, result.formatted);
    } else {
      onSend(content);
    }
    setText("");
  };

  const cmd = parseMathCommand(text);
  let mathBar: ReactNode = null;
  if (cmd) {
    if (cmd.kind === "hint") {
      const complete = !isMathCommand(text);
      mathBar = (
        <Pressable
          disabled={!complete}
          onPress={() => {
            setText("/math ");
            input.current?.focus();
          }}
          style={[styles.math, { backgroundColor: c.surfaceHigh }]}
        >
          <Text style={{ fontSize: 18 }}>🧮</Text>
          <Text muted style={{ flex: 1, marginLeft: 10, fontSize: 13 }}>
            <Text style={{ color: c.primary, fontWeight: "700", fontFamily: "monospace", fontSize: 13 }}>/math</Text>
            <Text style={{ fontFamily: "monospace", fontSize: 13 }}> [expression]</Text> — Instant calculator (e.g.{" "}
            <Text style={{ fontFamily: "monospace", fontSize: 13 }}>/math (120 * 4) / 3</Text>)
          </Text>
          {complete ? (
            <Text muted style={{ fontSize: 11, marginLeft: 8 }}>
              Tap to use
            </Text>
          ) : null}
        </Pressable>
      );
    } else {
      const r = evaluateMath(cmd.expression);
      mathBar = (
        <View style={[styles.math, { backgroundColor: c.surfaceHigh }]} accessibilityLiveRegion="polite">
          <Text style={{ fontSize: 18 }}>🧮</Text>
          <Text
            numberOfLines={1}
            style={
              r.ok
                ? { flex: 1, marginLeft: 10, color: c.primary, fontSize: 18, fontWeight: "700", fontVariant: ["tabular-nums"] }
                : { flex: 1, marginLeft: 10, color: c.warning, fontSize: 13 }
            }
          >
            {r.ok ? `= ${r.formatted}` : r.error}
          </Text>
        </View>
      );
    }
  }

  return (
    <View style={[styles.wrap, { borderTopColor: c.border, backgroundColor: c.bg }]}>
      {mathBar}
      <View style={[styles.row, { paddingVertical: s(8), paddingRight: s(8) }]}>
        <IconButton name="add-circle-outline" label="Attach" onPress={onAttach} color={c.muted} size={26} />
        <TextInput
          ref={input}
          value={text}
          onChangeText={setText}
          placeholder="Message"
          multiline
          maxLength={Config.messageMaxLength}
          autoCapitalize="sentences"
          style={[styles.input, { backgroundColor: c.surface, paddingHorizontal: s(16) }]}
          accessibilityLabel="Message"
        />
        <View style={{ width: 6 }} />
        {empty ? (
          <IconButton name="mic" label="Record voice message" filled onPress={onRecord} size={22} />
        ) : (
          <IconButton name="send" label="Send" filled onPress={submit} size={20} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderTopWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", alignItems: "flex-end", paddingLeft: 4 },
  input: { flex: 1, minHeight: 40, maxHeight: 140, borderRadius: 20, paddingTop: 10, paddingBottom: 10, fontSize: 16 },
  math: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 8,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 14,
  },
});
