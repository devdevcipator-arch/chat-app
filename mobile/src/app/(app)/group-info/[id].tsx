import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Cache } from "../../../data/cache";
import { ChatRepo } from "../../../data/chats";
import { Config } from "../../../lib/config";
import { chatActionError } from "../../../lib/errors";
import { plural } from "../../../lib/format";
import { type ChatDetails, type ChatMember, type Profile, avatarImageUrl, detailsName, profileName } from "../../../models/types";
import { MemberPicker } from "../../../features/MemberPicker";
import { useAuth } from "../../../state/auth";
import { Chats } from "../../../state/chats";
import { Avatar, Button, Center, Divider, Icon, IconButton, Spinner, toast } from "../../../ui/components";
import { confirm, prompt, showActions } from "../../../ui/sheets";
import { Text } from "../../../ui/Text";
import { usePalette, useScale } from "../../../ui/theme";

/** Group members and admin controls. */
export default function GroupInfo() {
  const { id: chatId } = useLocalSearchParams<{ id: string }>();
  const c = usePalette();
  const { s } = useScale();
  const insets = useSafeAreaInsets();
  const meId = useAuth((st) => st.userId)!;
  const [details, setDetails] = useState<ChatDetails | null>(() => Cache.details(meId, chatId));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await ChatRepo.details(chatId);
      if (!d) {
        Chats.remove(chatId);
        router.dismissTo("/");
        return;
      }
      Cache.saveDetails(meId, d);
      setDetails(d);
      setError(null);
    } catch (e) {
      setError(chatActionError(e));
    }
  }, [chatId, meId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<void>, done?: string, leave = false) => {
    setBusy(true);
    try {
      await action();
      if (done) toast(done);
      if (leave) {
        Chats.remove(chatId);
        router.dismissTo("/");
        return;
      }
      await load();
      Chats.refreshSoon();
    } catch (e) {
      toast(chatActionError(e));
    } finally {
      setBusy(false);
    }
  };

  if (!details) return <Center>{error ? <Text>{error}</Text> : <Spinner />}</Center>;

  const name = detailsName(details, meId);

  const rename = async () => {
    const title = await prompt("Rename group", details.title ?? "", { maxLength: Config.groupTitleMax });
    if (!title || title === details.title) return;
    await run(() => ChatRepo.renameGroup(chatId, title), "Group renamed");
  };

  const memberActions = (m: ChatMember) => {
    const isMe = m.profile.id === meId;
    showActions({
      title: profileName(m.profile),
      subtitle: m.profile.username ? `@${m.profile.username}` : undefined,
      actions: [
        ...(!isMe
          ? [
              {
                label: "Message",
                icon: "chatbubble-outline" as const,
                onPress: async () => {
                  setBusy(true);
                  try {
                    const dm = await ChatRepo.createDirectChat(m.profile.id);
                    Chats.refreshSoon();
                    router.dismissTo("/");
                    router.push({ pathname: "/chat/[id]", params: { id: dm } });
                  } catch (e) {
                    toast(chatActionError(e));
                  } finally {
                    setBusy(false);
                  }
                },
              },
            ]
          : []),
        ...(details.isAdmin && !isMe
          ? [
              {
                label: m.isAdmin ? "Remove as admin" : "Make admin",
                icon: m.isAdmin ? ("shield-outline" as const) : ("shield-checkmark-outline" as const),
                onPress: () => void run(() => ChatRepo.setRole(chatId, m.profile.id, !m.isAdmin)),
              },
              {
                label: "Remove from group",
                icon: "person-remove-outline" as const,
                destructive: true,
                onPress: async () => {
                  if (await confirm(`Remove ${profileName(m.profile)}?`, "They will no longer see new messages.", "Remove")) {
                    await run(() => ChatRepo.removeMember(chatId, m.profile.id));
                  }
                },
              },
            ]
          : []),
      ],
    });
  };

  return (
    <>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
            tintColor={c.primary}
            colors={[c.primary]}
          />
        }
      >
        {busy ? <View style={[styles.progress, { backgroundColor: c.primary }]} /> : null}
        <View style={{ alignItems: "center", paddingTop: s(24), paddingBottom: s(16) }}>
          <Avatar name={name} group size={s(88)} />
          <View style={styles.titleRow}>
            <Text style={{ fontSize: s(22), fontWeight: "600", textAlign: "center", flexShrink: 1 }}>{name}</Text>
            {details.isAdmin ? <IconButton name="create-outline" label="Rename group" onPress={rename} disabled={busy} /> : null}
          </View>
          <Text muted>{plural(details.members.length, "member")}</Text>
        </View>

        {details.isAdmin ? (
          <Pressable
            onPress={() => setAdding(true)}
            disabled={busy}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.surface }]}
          >
            <View style={[styles.addIcon, { backgroundColor: `${c.primary}22` }]}>
              <Icon name="person-add-outline" color={c.primary} size={20} />
            </View>
            <Text style={{ marginLeft: 14, fontSize: 16, color: c.primary, fontWeight: "500" }}>Add members</Text>
          </Pressable>
        ) : null}

        {details.members.map((m) => (
          <Pressable
            key={m.profile.id}
            onPress={() => memberActions(m)}
            disabled={busy}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.surface }]}
          >
            <Avatar name={profileName(m.profile)} uri={avatarImageUrl(m.profile)} />
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={{ fontSize: 16 }} numberOfLines={1}>
                {m.profile.id === meId ? `${profileName(m.profile)} (you)` : profileName(m.profile)}
              </Text>
              {m.profile.username ? (
                <Text muted style={{ fontSize: 13 }}>
                  @{m.profile.username}
                </Text>
              ) : null}
            </View>
            {m.isAdmin ? (
              <View style={[styles.adminChip, { backgroundColor: c.surfaceHigh }]}>
                <Text style={{ fontSize: 12, fontWeight: "600" }}>Admin</Text>
              </View>
            ) : null}
          </Pressable>
        ))}

        <Divider />
        <Pressable
          disabled={busy}
          onPress={async () => {
            if (await confirm("Leave group?", "You won't get new messages from this group.", "Leave")) {
              await run(() => ChatRepo.leaveGroup(chatId), undefined, true);
            }
          }}
          style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.surface }]}
        >
          <Icon name="exit-outline" color={c.error} />
          <Text style={{ marginLeft: 14, fontSize: 16, color: c.error }}>Leave group</Text>
        </Pressable>
        {details.isAdmin ? (
          <Pressable
            disabled={busy}
            onPress={async () => {
              if (await confirm("Delete group?", "The group and its messages are deleted for everyone.", "Delete")) {
                await run(() => ChatRepo.deleteGroup(chatId), undefined, true);
              }
            }}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.surface }]}
          >
            <Icon name="trash-outline" color={c.error} />
            <Text style={{ marginLeft: 14, fontSize: 16, color: c.error }}>Delete group</Text>
          </Pressable>
        ) : null}
      </ScrollView>
      <AddMembers
        visible={adding}
        meId={meId}
        existing={new Set(details.members.map((m) => m.profile.id))}
        onClose={() => setAdding(false)}
        onAdd={async (people) => {
          setAdding(false);
          await run(
            () => ChatRepo.addMembers(chatId, people.map((p) => p.id)),
            `Added ${people.length} ${people.length === 1 ? "person" : "people"}`,
          );
        }}
      />
    </>
  );
}

function AddMembers({
  visible,
  meId,
  existing,
  onClose,
  onAdd,
}: {
  visible: boolean;
  meId: string;
  existing: Set<string>;
  onClose: () => void;
  onAdd: (people: Profile[]) => void;
}) {
  const c = usePalette();
  const [selected, setSelected] = useState<Profile[]>([]);
  useEffect(() => {
    if (visible) setSelected([]);
  }, [visible]);
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.bg, padding: 16 }}>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
          <Text style={{ fontSize: 20, fontWeight: "600", flex: 1 }}>Add members</Text>
          <IconButton name="close" label="Close" onPress={onClose} />
        </View>
        <MemberPicker meId={meId} selected={selected} onChange={setSelected} excludeIds={existing} />
        <Button title="Add" onPress={() => onAdd(selected)} disabled={!selected.length} style={{ marginTop: 20 }} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  progress: { height: 2 },
  titleRow: { flexDirection: "row", alignItems: "center", marginTop: 12, paddingHorizontal: 24 },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, minHeight: 60 },
  addIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  adminChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
});
