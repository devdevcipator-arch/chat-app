import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChatRepo } from "../../data/chats";
import { Config } from "../../lib/config";
import { chatActionError } from "../../lib/errors";
import type { Profile } from "../../models/types";
import { MemberPicker } from "../../features/MemberPicker";
import { useAuth } from "../../state/auth";
import { Chats } from "../../state/chats";
import { Button, ErrorText, Icon } from "../../ui/components";
import { Text, TextInput } from "../../ui/Text";
import { usePalette } from "../../ui/theme";

/** Creates a group, then opens it. */
export default function NewGroup() {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const meId = useAuth((s) => s.userId)!;
  const [title, setTitle] = useState("");
  const [members, setMembers] = useState<Profile[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = title.trim().length > 0 && members.length > 0;

  const create = async () => {
    setSaving(true);
    setError(null);
    try {
      const chatId = await ChatRepo.createGroup(title.trim(), members.map((m) => m.id));
      await Chats.refresh();
      router.replace({ pathname: "/chat/[id]", params: { id: chatId } });
    } catch (e) {
      setSaving(false);
      setError(chatActionError(e));
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
        <Text muted style={styles.label}>
          Group name
        </Text>
        <View style={[styles.input, { borderColor: c.border, backgroundColor: c.surface }]}>
          <Icon name="people-outline" color={c.muted} size={20} />
          <TextInput
            value={title}
            onChangeText={setTitle}
            maxLength={Config.groupTitleMax}
            autoCapitalize="sentences"
            placeholder="e.g. Book Club"
            style={{ flex: 1, height: "100%", fontSize: 16, marginLeft: 10 }}
            accessibilityLabel="Group name"
          />
        </View>
        <Text muted style={{ fontSize: 11.5, alignSelf: "flex-end", marginTop: 4 }}>
          {title.length}/{Config.groupTitleMax}
        </Text>
        <Text muted style={[styles.label, { marginTop: 8 }]}>
          Members
        </Text>
        <MemberPicker meId={meId} selected={members} onChange={setMembers} />
        <ErrorText message={error} />
        <Button
          title={`Create group${members.length ? ` (${members.length + 1})` : ""}`}
          onPress={create}
          loading={saving}
          disabled={!valid}
          style={{ marginTop: 24 }}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, marginBottom: 6 },
  input: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, height: 50 },
});
