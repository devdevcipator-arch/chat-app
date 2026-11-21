import { FlashList } from "@shopify/flash-list";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GalleryRepo } from "../../data/gallery";
import { AppError } from "../../lib/errors";
import { type ChatSummary, avatarImageUrl, chatName } from "../../models/types";
import { useChats } from "../../state/chats";
import { Messages } from "../../state/messages";
import { Avatar, Button, Divider, Icon, toast } from "../../ui/components";
import { Text } from "../../ui/Text";
import { usePalette } from "../../ui/theme";

/**
 * Forward a gallery item, in two explicit steps: select a chat, then tap
 * "Send" (a mis-tap on a row never sends anything).
 */
export default function Forward() {
  const { id, name } = useLocalSearchParams<{ id: string; name: string }>();
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const chats = useChats((s) => s.chats);
  const [selected, setSelected] = useState<ChatSummary | null>(null);
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!selected) return;
    setSending(true);
    try {
      Messages.addDelivered(await GalleryRepo.forward(id, selected.chatId));
      toast(`Sent to ${chatName(selected)}`);
      router.back();
    } catch (e) {
      setSending(false);
      toast(e instanceof AppError ? e.message : "Couldn't send that file.");
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Text muted style={{ paddingHorizontal: 16, paddingVertical: 10 }} numberOfLines={1}>
        Choose a chat for {name}
      </Text>
      <FlashList
        data={chats}
        keyExtractor={(ch) => ch.chatId}
        extraData={selected?.chatId}
        ItemSeparatorComponent={() => <Divider inset={72} />}
        renderItem={({ item }) => {
          const active = selected?.chatId === item.chatId;
          return (
            <Pressable
              onPress={() => setSelected(active ? null : item)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              style={[styles.row, active && { backgroundColor: `${c.primary}1A` }]}
            >
              <Avatar name={chatName(item)} uri={item.type === "group" ? null : avatarImageUrl(item.other)} group={item.type === "group"} />
              <Text style={{ flex: 1, marginLeft: 14, fontSize: 16 }} numberOfLines={1}>
                {chatName(item)}
              </Text>
              <Icon name={active ? "checkmark-circle" : "ellipse-outline"} color={active ? c.primary : c.muted} />
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Text muted style={{ textAlign: "center", paddingTop: 48 }}>
            No conversations yet.
          </Text>
        }
      />
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 10) + 12, borderTopColor: c.border }]}>
        <Button
          title={selected ? `Send to ${chatName(selected)}` : "Select a chat"}
          icon="send"
          disabled={!selected}
          loading={sending}
          onPress={send}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10 },
  footer: { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
});
