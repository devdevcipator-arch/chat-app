import { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { create } from "zustand";
import { Button, Icon, type IconName } from "./components";
import { Text, TextInput } from "./Text";
import { usePalette } from "./theme";

// ---------------------------------------------------------------------------
// Action sheet
// ---------------------------------------------------------------------------

export type SheetAction = { label: string; icon?: IconName; destructive?: boolean; onPress: () => void };
type SheetState = { title?: string; subtitle?: string; actions: SheetAction[] } | null;

const useSheet = create<{ sheet: SheetState }>(() => ({ sheet: null }));

export const showActions = (sheet: NonNullable<SheetState>) => useSheet.setState({ sheet });

/** Native confirm dialog; resolves true when the user confirms. */
export function confirm(title: string, message: string, action: string, destructive = true): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(
      title,
      message,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: action, style: destructive ? "destructive" : "default", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
}

// ---------------------------------------------------------------------------
// Text prompt (edit message, rename group)
// ---------------------------------------------------------------------------

type PromptState = {
  title: string;
  initial: string;
  maxLength?: number;
  multiline?: boolean;
  action: string;
  resolve: (value: string | null) => void;
} | null;

const usePrompt = create<{ prompt: PromptState }>(() => ({ prompt: null }));

export function prompt(
  title: string,
  initial: string,
  opts: { maxLength?: number; multiline?: boolean; action?: string } = {},
): Promise<string | null> {
  return new Promise((resolve) =>
    usePrompt.setState({ prompt: { title, initial, action: opts.action ?? "Save", ...opts, resolve } }),
  );
}

export function SheetHost() {
  const sheet = useSheet((s) => s.sheet);
  const p = usePrompt((s) => s.prompt);
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const close = () => useSheet.setState({ sheet: null });

  return (
    <>
      <Modal visible={!!sheet} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
        <Pressable style={[styles.backdrop, { backgroundColor: c.overlay }]} onPress={close} accessibilityLabel="Close">
          <Pressable style={[styles.sheet, { backgroundColor: c.surface, paddingBottom: insets.bottom + 8 }]}>
            <View style={[styles.handle, { backgroundColor: c.surfaceHighest }]} />
            {sheet?.title ? (
              <View style={styles.sheetHeader}>
                <Text style={{ fontSize: 16, fontWeight: "600" }} numberOfLines={1}>
                  {sheet.title}
                </Text>
                {sheet.subtitle ? (
                  <Text muted style={{ fontSize: 13 }} numberOfLines={1}>
                    {sheet.subtitle}
                  </Text>
                ) : null}
              </View>
            ) : null}
            <ScrollView bounces={false} style={{ maxHeight: 420 }}>
              {sheet?.actions.map((a) => (
                <Pressable
                  key={a.label}
                  accessibilityRole="button"
                  onPress={() => {
                    close();
                    // Let the sheet close before a follow-up dialog opens.
                    setTimeout(a.onPress, Platform.OS === "ios" ? 350 : 50);
                  }}
                  style={({ pressed }) => [styles.action, pressed && { backgroundColor: c.surfaceHigh }]}
                >
                  {a.icon ? <Icon name={a.icon} size={22} color={a.destructive ? c.error : c.text} /> : null}
                  <Text style={[styles.actionText, a.destructive && { color: c.error }]}>{a.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
      <PromptModal state={p} />
    </>
  );
}

function PromptModal({ state }: { state: PromptState }) {
  const c = usePalette();
  const [value, setValue] = useState("");
  useEffect(() => {
    if (state) setValue(state.initial);
  }, [state]);
  const done = (result: string | null) => {
    state?.resolve(result);
    usePrompt.setState({ prompt: null });
  };
  return (
    <Modal visible={!!state} transparent animationType="fade" onRequestClose={() => done(null)} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[styles.center, { backgroundColor: c.overlay }]}>
        <View style={[styles.dialog, { backgroundColor: c.surface }]}>
          <Text style={{ fontSize: 18, fontWeight: "600", marginBottom: 12 }}>{state?.title}</Text>
          <TextInput
            autoFocus
            value={value}
            onChangeText={setValue}
            maxLength={state?.maxLength}
            multiline={state?.multiline}
            style={[styles.input, { borderColor: c.border, backgroundColor: c.bg, maxHeight: 160 }]}
          />
          {state?.maxLength ? (
            <Text muted style={{ fontSize: 11, alignSelf: "flex-end", marginTop: 4 }}>
              {value.length}/{state.maxLength}
            </Text>
          ) : null}
          <View style={styles.dialogActions}>
            <Button title="Cancel" variant="text" compact onPress={() => done(null)} />
            <Button title={state?.action ?? "Save"} compact onPress={() => done(value.trim())} disabled={!value.trim()} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 8 },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 8 },
  sheetHeader: { paddingHorizontal: 20, paddingVertical: 8 },
  action: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, minHeight: 52, gap: 16 },
  actionText: { fontSize: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  dialog: { width: "100%", maxWidth: 420, borderRadius: 18, padding: 20 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  dialogActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 16 },
});
