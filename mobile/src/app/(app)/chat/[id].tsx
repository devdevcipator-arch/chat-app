import * as Clipboard from "expo-clipboard";
import { FlashList } from "@shopify/flash-list";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useCallback, useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Cache } from "../../../data/cache";
import { CallRepo } from "../../../data/calls";
import { ChatRepo } from "../../../data/chats";
import { GalleryRepo } from "../../../data/gallery";
import { Config } from "../../../lib/config";
import { AppError, chatActionError, dbErrorMessage } from "../../../lib/errors";
import {
  type ActiveGroupCall,
  type ChatDetails,
  type ChatMessage,
  type GalleryItem,
  avatarImageUrl,
  canEdit,
  chatName,
  detailsMember,
  detailsName,
  detailsOther,
  messagePublicUrl,
  profileName,
} from "../../../models/types";
import { useAuth } from "../../../state/auth";
import { Calls, useCall } from "../../../state/calls";
import { Chats, useChats } from "../../../state/chats";
import { Messages, useMessages } from "../../../state/messages";
import { Network, useNetwork } from "../../../state/network";
import { Realtime } from "../../../state/realtime";
import { Avatar, Button, Center, Icon, IconButton, OfflineBanner, Spinner, toast } from "../../../ui/components";
import { confirm, prompt, showActions } from "../../../ui/sheets";
import { Text } from "../../../ui/Text";
import { usePalette, useScale } from "../../../ui/theme";
import { compressForChat, pickFiles, pickPhoto, pickVideo } from "../../../features/chat/attachments";
import { Composer } from "../../../features/chat/Composer";
import { GalleryPicker } from "../../../features/chat/GalleryPicker";
import { MessageBubble, openExternally } from "../../../features/chat/MessageBubble";
import { VoiceRecorder } from "../../../features/chat/VoiceRecorder";

export default function ChatScreen() {
  const { id: chatId } = useLocalSearchParams<{ id: string }>();
  const c = usePalette();
  const { s } = useScale();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const meId = useAuth((st) => st.userId)!;
  const online = useNetwork((st) => st.online);
  const summary = useChats((st) => st.chats.find((ch) => ch.chatId === chatId) ?? null);

  // Everything renders from local state on the first frame; the network refines it.
  const [details, setDetails] = useState<ChatDetails | null>(() => Cache.details(meId, chatId));
  const messages = useMessages((st) => st.byChat[chatId]) ?? Messages.get(chatId);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [synced, setSynced] = useState(false);
  const [live, setLive] = useState(Realtime.live);
  const [recording, setRecording] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [groupCall, setGroupCall] = useState<ActiveGroupCall | null>(null);
  const inCallId = useCall((st) => st.call?.id ?? null);

  const isGroup = details ? details.type === "group" : summary?.type === "group";
  const other = details ? detailsOther(details, meId) : (summary?.other ?? null);
  const name = details ? detailsName(details, meId) : summary ? chatName(summary) : "";

  const refreshDetails = useCallback(async () => {
    const d = await ChatRepo.details(chatId);
    if (!d) {
      toast("You're no longer in this conversation.");
      Chats.remove(chatId);
      router.back();
      return null;
    }
    Cache.saveDetails(meId, d);
    setDetails(d);
    return d;
  }, [chatId, meId]);

  const load = useCallback(async () => {
    try {
      const [d] = await Promise.all([refreshDetails(), Messages.sync(chatId)]);
      Network.reportSuccess();
      setLoadError(null);
      setSynced(true);
      if (d) void ChatRepo.markRead(chatId);
    } catch (e) {
      Network.reportFailure(e);
      setLoadError(dbErrorMessage(e));
      setSynced(true);
    }
  }, [chatId, refreshDetails]);

  useEffect(() => {
    Chats.setOpen(chatId);
    void load();
    const offStatus = Realtime.onStatus((v) => {
      setLive(v);
      if (v) void Messages.sync(chatId).catch(() => {});
    });
    const offReconnect = Network.onReconnect(() => void load());
    const offMessage = Realtime.onMessage((m, isUpdate) => {
      if (m.chatId !== chatId || isUpdate) return;
      if (m.senderId !== meId) void ChatRepo.markRead(chatId);
      if (m.type === "system") void refreshDetails().catch(() => {});
    });
    return () => {
      Chats.setOpen(null);
      offStatus();
      offReconnect();
      offMessage();
    };
  }, [chatId, meId, load, refreshDetails]);

  // Group rooms: banner while a call is running in this group.
  useEffect(() => {
    if (!isGroup) return;
    const check = () => void CallRepo.groupCall(chatId).then(setGroupCall);
    check();
    return Realtime.onCall((_e, row) => {
      if (row.chatId === chatId) check();
    });
  }, [chatId, isGroup]);

  // --- Actions ---------------------------------------------------------------

  const startCall = (video: boolean) => {
    if (Calls.busy) return toast("You're already in a call.");
    if (!details) return toast(online ? "Loading the conversation…" : "You're offline.");
    if (details.type === "group") {
      void Calls.joinGroup(
        chatId,
        detailsName(details, meId),
        Object.fromEntries(details.members.map((m) => [m.profile.id, m.profile])),
        video,
      );
    } else {
      const peer = detailsOther(details, meId);
      if (!peer) return toast("That account is no longer available.");
      void Calls.startDirect(chatId, peer, video);
    }
  };

  const sendFile = (file: { uri: string; name: string; size?: number | null }, opts?: { durationSeconds?: number }) => {
    const error = Messages.sendFile(chatId, file, opts);
    if (error) toast(error);
  };

  const attach = () =>
    showActions({
      actions: [
        { label: "Camera", icon: "camera-outline", onPress: () => void pickImage("camera") },
        { label: "Photo from device", icon: "image-outline", onPress: () => void pickImage("library") },
        { label: "Video from device", icon: "videocam-outline", onPress: () => void guard(async () => {
          const v = await pickVideo();
          if (v) sendFile(v);
        }) },
        { label: "From my Gallery", icon: "albums-outline", onPress: () => setGalleryOpen(true) },
        { label: "Any file (EPUB, PDF, ZIP…)", icon: "attach-outline", onPress: () => void guard(async () => {
          const [f] = await pickFiles();
          if (f) sendFile(f);
        }) },
      ],
    });

  const guard = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      toast(e instanceof Error && e.message === "Permission denied." ? "Permission denied." : e instanceof Error ? e.message : "Couldn't open the picker.");
    }
  };

  const pickImage = (source: "camera" | "library") =>
    guard(async () => {
      const asset = await pickPhoto(source);
      if (asset) sendFile(await compressForChat(asset));
    });

  const forwardFromGallery = async (item: GalleryItem) => {
    setGalleryOpen(false);
    toast(`Sending ${item.fileName}…`);
    try {
      Messages.addDelivered(await GalleryRepo.forward(item.id, chatId));
    } catch (e) {
      toast(e instanceof AppError ? e.message : "Couldn't send that file.");
    }
  };

  const onLongPress = useCallback(
    (m: ChatMessage) => {
      const url = messagePublicUrl(m);
      const actions = [
        ...(m.type === "text"
          ? [{ label: "Copy text", icon: "copy-outline" as const, onPress: () => void Clipboard.setStringAsync(m.content ?? "").then(() => toast("Copied")) }]
          : []),
        ...(canEdit(m, meId)
          ? [
              {
                label: "Edit message",
                icon: "create-outline" as const,
                onPress: async () => {
                  const text = await prompt("Edit message", m.content ?? "", { maxLength: Config.messageMaxLength, multiline: true });
                  if (!text || text === m.content) return;
                  try {
                    await Messages.edit(m, text);
                  } catch (e) {
                    toast(e instanceof AppError ? e.message : "Couldn't edit the message.");
                  }
                },
              },
            ]
          : []),
        ...(url ? [{ label: "Open / download", icon: "open-outline" as const, onPress: () => openExternally(url) }] : []),
      ];
      if (actions.length) showActions({ actions });
    },
    [meId],
  );

  const onRetry = useCallback((m: ChatMessage) => {
    showActions({
      title: m.error ?? "Not sent",
      actions: [
        { label: "Retry", icon: "refresh", onPress: () => Messages.retry(m) },
        { label: "Delete", icon: "trash-outline", destructive: true, onPress: () => Messages.discard(m) },
      ],
    });
  }, []);

  const onVoicemailPlayed = useCallback(
    async (m: ChatMessage) => {
      if (m.senderId === meId || m.voicemailPlayedAt) return;
      const at = await ChatRepo.markVoicemailPlayed(m.id);
      if (at) Messages.markVoicemailPlayed(chatId, m.id, at);
    },
    [chatId, meId],
  );

  const run = async (action: () => Promise<void>, done?: string, leave = false) => {
    try {
      await action();
      if (done) toast(done);
      if (leave) {
        Chats.remove(chatId);
        router.back();
      }
    } catch (e) {
      toast(chatActionError(e));
    }
  };

  const menu = () => {
    if (!details) return;
    showActions({
      title: name,
      actions: [
        ...(isGroup ? [{ label: "Group info", icon: "information-circle-outline" as const, onPress: openInfo }] : []),
        {
          label: details.isMuted ? "Unmute" : "Mute notifications",
          icon: details.isMuted ? ("notifications-outline" as const) : ("notifications-off-outline" as const),
          onPress: () =>
            void run(async () => {
              await ChatRepo.setMuted(chatId, !details.isMuted);
              const next = { ...details, isMuted: !details.isMuted };
              setDetails(next);
              Cache.saveDetails(meId, next);
              Chats.patch(chatId, { isMuted: next.isMuted });
            }, details.isMuted ? "Notifications on" : "Muted"),
        },
        {
          label: "Clear chat",
          icon: "brush-outline",
          onPress: async () => {
            if (await confirm("Clear chat?", "Messages are removed for you only. Others still see them.", "Clear")) {
              await run(async () => {
                await ChatRepo.clearChat(chatId);
                Messages.clearLocal(chatId);
              }, "Chat cleared");
            }
          },
        },
        isGroup
          ? {
              label: "Leave group",
              icon: "exit-outline",
              destructive: true,
              onPress: async () => {
                if (await confirm("Leave group?", "You won't get new messages from this group.", "Leave")) {
                  await run(() => ChatRepo.leaveGroup(chatId), undefined, true);
                }
              },
            }
          : {
              label: "Delete conversation",
              icon: "trash-outline",
              destructive: true,
              onPress: async () => {
                if (await confirm("Delete conversation?", "It disappears from your list. A new message brings it back.", "Delete")) {
                  await run(() => ChatRepo.hideChat(chatId), undefined, true);
                }
              },
            },
      ],
    });
  };

  const openInfo = () => router.push({ pathname: "/group-info/[id]", params: { id: chatId } });

  // --- Rendering ---------------------------------------------------------------

  const renderItem = useCallback(
    ({ item, index }: { item: ChatMessage; index: number }) => {
      const previous = index > 0 ? messages[index - 1] : null;
      const grouped = previous?.senderId === item.senderId && previous?.type !== "system";
      const mine = item.senderId === meId;
      return (
        <MessageBubble
          message={item}
          mine={mine}
          grouped={grouped}
          senderName={isGroup && !mine && !grouped ? profileName(detailsMember(details, item.senderId)) : null}
          onLongPress={onLongPress}
          onRetry={onRetry}
          onVoicemailPlayed={onVoicemailPlayed}
        />
      );
    },
    [messages, meId, isGroup, details, onLongPress, onRetry, onVoicemailPlayed],
  );

  const subtitle = isGroup ? (details ? `${details.members.length} members` : "") : other?.username ? `@${other.username}` : "";

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <Pressable
              onPress={isGroup ? openInfo : undefined}
              style={styles.headerTitle}
              accessibilityRole={isGroup ? "button" : "header"}
              accessibilityLabel={isGroup ? `${name}, group info` : name}
            >
              <Avatar name={name || "?"} uri={isGroup ? null : avatarImageUrl(other)} group={isGroup} size={s(36)} />
              <View style={{ marginLeft: s(10), flexShrink: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Text style={{ fontSize: 16, fontWeight: "600", flexShrink: 1 }} numberOfLines={1}>
                    {name}
                  </Text>
                  {details?.isMuted ? <Icon name="notifications-off" size={14} color={c.muted} /> : null}
                </View>
                {subtitle ? (
                  <Text muted style={{ fontSize: 12 }} numberOfLines={1}>
                    {!live && online ? "Reconnecting…" : subtitle}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ),
          headerRight: () => (
            <View style={styles.headerActions}>
              <IconButton name="call-outline" label="Voice call" onPress={() => startCall(false)} disabled={!details} />
              <IconButton name="videocam-outline" label="Video call" onPress={() => startCall(true)} disabled={!details} />
              <IconButton name="ellipsis-vertical" label="More" onPress={menu} disabled={!details} />
            </View>
          ),
        }}
      />
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: c.bg }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={headerHeight}
      >
        <OfflineBanner message="Offline — showing saved messages" />
        {groupCall ? (
          <View style={[styles.callBanner, { backgroundColor: `${c.primary}1F` }]}>
            <Icon name={groupCall.callType === "video" ? "videocam" : "call"} color={c.primary} size={20} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={{ fontWeight: "600" }}>{groupCall.callType === "video" ? "Video" : "Voice"} call in progress</Text>
              <Text muted style={{ fontSize: 12.5 }}>
                {groupCall.participantIds.length} in the call
              </Text>
            </View>
            {inCallId === groupCall.callId ? (
              <Text muted>Joined</Text>
            ) : (
              <Button title="Join" compact onPress={() => startCall(groupCall.callType === "video")} />
            )}
          </View>
        ) : null}

        <View style={{ flex: 1 }}>
          {messages.length === 0 ? (
            !synced && !loadError ? (
              <Center>
                <Spinner />
              </Center>
            ) : loadError ? (
              <Center>
                <Text style={{ marginBottom: 12, textAlign: "center" }}>{loadError}</Text>
                <Button title="Retry" variant="outline" compact onPress={() => void load()} />
              </Center>
            ) : (
              <Center>
                <Text muted style={{ textAlign: "center", lineHeight: 22 }}>
                  {isGroup
                    ? `No messages in ${name} yet.\nSay hi 👋`
                    : `This is the start of your conversation with ${name}.\nSay hi 👋`}
                </Text>
              </Center>
            )
          ) : (
            <FlashList
              data={messages}
              renderItem={renderItem}
              keyExtractor={(m) => m.id}
              getItemType={(m) => (m.type === "system" ? "system" : m.type)}
              maintainVisibleContentPosition={{ startRenderingFromBottom: true, autoscrollToBottomThreshold: 0.2 }}
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: s(12), paddingVertical: s(10) }}
            />
          )}
        </View>

        <View style={{ paddingBottom: insets.bottom }}>
          {recording ? (
            <VoiceRecorder
              onCancel={() => setRecording(false)}
              onDone={(rec) => {
                setRecording(false);
                sendFile({ uri: rec.uri, name: "voice-note.m4a" }, { durationSeconds: rec.seconds });
              }}
            />
          ) : (
            <Composer
              onSend={(text) => Messages.sendText(chatId, text)}
              onSendMath={(expression, formatted) => Messages.sendMath(chatId, expression, formatted)}
              onNotice={toast}
              onAttach={attach}
              onRecord={() => setRecording(true)}
            />
          )}
        </View>
      </KeyboardAvoidingView>
      <GalleryPicker visible={galleryOpen} onClose={() => setGalleryOpen(false)} onPick={forwardFromGallery} />
    </>
  );
}

const styles = StyleSheet.create({
  headerTitle: { flexDirection: "row", alignItems: "center", maxWidth: 220 },
  headerActions: { flexDirection: "row", alignItems: "center" },
  callBanner: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10 },
});
