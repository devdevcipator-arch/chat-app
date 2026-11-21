import { FlashList } from "@shopify/flash-list";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { Cache } from "../../../data/cache";
import { CallRepo } from "../../../data/calls";
import { formatDateTime } from "../../../lib/format";
import { formatDuration } from "../../../lib/media";
import { type Profile, avatarImageUrl, chatName, profileFromRow, profileName } from "../../../models/types";
import { openChat, TabHeader } from "../../../features/chatList";
import { useAuth } from "../../../state/auth";
import { Calls, useCall } from "../../../state/calls";
import { useChats } from "../../../state/chats";
import { MissedCalls, useMissedCalls } from "../../../state/missedCalls";
import { Network } from "../../../state/network";
import { Avatar, Button, Divider, Icon, IconButton, OfflineBanner, Spinner, toast } from "../../../ui/components";
import { Text } from "../../../ui/Text";
import { usePalette, useScale } from "../../../ui/theme";

type Direction = "incoming" | "outgoing" | "missed" | "declined" | "ongoing";
const LABEL: Record<Direction, string> = {
  incoming: "Incoming",
  outgoing: "Outgoing",
  missed: "Missed",
  declined: "Declined",
  ongoing: "Ongoing",
};

type CallLog = {
  id: string;
  chatId: string;
  video: boolean;
  isGroup: boolean;
  createdAt: string;
  direction: Direction;
  /** "Declined" / "No answer" etc. shown after the direction. */
  detail: string | null;
  durationSeconds: number | null;
  /** The other person (direct calls) or whoever started it (group calls). */
  peer: Profile | null;
};

type Row = Record<string, unknown>;

/** Same classification as web/src/app/chat/calls-panel.tsx. */
function toLog(row: Row, meId: string): CallLog {
  const outgoing = row.caller_id === meId;
  const status = String(row.status);
  const isGroup = row.is_group === true;
  const live = status === "ringing" || status === "accepted" || status === "active";
  const participants = (Array.isArray(row.call_participants) ? row.call_participants : []) as Row[];
  let direction: Direction;
  let detail: string | null = null;
  if (live) direction = "ongoing";
  else if (isGroup) {
    const joined = outgoing || participants.some((p) => p.user_id === meId);
    direction = outgoing ? "outgoing" : joined ? "incoming" : "missed";
  } else if (outgoing) {
    direction = "outgoing";
    detail = status === "declined" ? "Declined" : status === "missed" ? "No answer" : status === "cancelled" ? "Cancelled" : null;
  } else if (status === "declined") direction = "declined";
  else if (status === "missed" || status === "cancelled") direction = "missed";
  else direction = "incoming";

  const from = Date.parse(String(row.answered_at ?? ""));
  const to = Date.parse(String(row.ended_at ?? ""));
  const secs = Number.isFinite(from) && Number.isFinite(to) ? (to - from) / 1000 : 0;
  const who = (isGroup || !outgoing ? row.caller : row.callee) as Row | null;

  return {
    id: String(row.id),
    chatId: String(row.chat_id),
    video: row.call_type === "video",
    isGroup,
    createdAt: String(row.created_at),
    direction,
    detail,
    durationSeconds: !live && secs > 0 ? secs : null,
    peer: who && typeof who === "object" ? profileFromRow(who) : null,
  };
}

/** Recent voice and video calls, newest first. */
export default function CallsTab() {
  const c = usePalette();
  const { s } = useScale();
  const meId = useAuth((st) => st.userId)!;
  const chats = useChats((st) => st.chats);
  const phase = useCall((st) => st.phase);
  const missed = useMissedCalls((st) => st.count);
  const [rows, setRows] = useState<Row[] | null>(() => Cache.rows(meId, "calls"));
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [focused, setFocused] = useState(false);

  const load = useCallback(async () => {
    try {
      const fresh = await CallRepo.history(meId);
      Network.reportSuccess();
      Cache.saveRows(meId, "calls", fresh);
      setRows(fresh);
      setFailed(false);
    } catch (e) {
      Network.reportFailure(e);
      setFailed(true);
    }
  }, [meId]);

  // Opening Calls clears its badge; keep it at zero while the tab is in view.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      MissedCalls.markSeen();
      void load();
      return () => setFocused(false);
    }, [load]),
  );
  useEffect(() => {
    if (focused && missed > 0) MissedCalls.markSeen();
  }, [focused, missed]);

  // Reload whenever a call starts or finishes.
  useEffect(() => {
    if (phase === "idle" || phase === "ended") void load();
  }, [phase, load]);

  const logs = useMemo(() => {
    try {
      return rows?.map((r) => toLog(r, meId)) ?? null;
    } catch {
      return null; // stale cache shape: wait for the fresh load
    }
  }, [rows, meId]);
  const chatsById = useMemo(() => new Map(chats.map((ch) => [ch.chatId, ch])), [chats]);

  const redial = (log: CallLog) => {
    if (Calls.busy) return toast("You're already in a call.");
    if (log.peer) void Calls.startDirect(log.chatId, log.peer, log.video);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const busy = phase !== "idle" && phase !== "ended";

  const renderItem = ({ item: log }: { item: CallLog }) => {
    const chat = chatsById.get(log.chatId);
    const name = log.isGroup ? (chat ? chatName(chat) : "Group") : profileName(log.peer ?? chat?.other);
    const bad = log.direction === "missed" || log.direction === "declined";
    const color = bad ? c.error : c.muted;
    const status = [LABEL[log.direction], log.detail, log.durationSeconds ? formatDuration(log.durationSeconds) : null]
      .filter(Boolean)
      .join(" · ");
    const canRedial = !log.isGroup && !!log.peer && !busy;
    return (
      <Pressable
        onPress={() => openChat(log.chatId)}
        style={({ pressed }) => [styles.row, { paddingHorizontal: s(16), paddingVertical: 13 }, pressed && { backgroundColor: c.surface }]}
        accessibilityLabel={`${name}, ${status}, ${formatDateTime(log.createdAt)}`}
      >
        <Avatar name={name} uri={log.isGroup ? null : avatarImageUrl(log.peer)} group={log.isGroup} size={48} />
        <View style={{ flex: 1, marginLeft: s(14), minWidth: 0 }}>
          <Text style={{ fontSize: 16, fontWeight: "500", color: bad ? c.error : c.text }} numberOfLines={1}>
            {name}
          </Text>
          <View style={[styles.row, { marginTop: 2 }]}>
            <Icon name={log.video ? "videocam-outline" : "call-outline"} size={13} color={color} />
            {log.direction === "ongoing" ? (
              <View style={[styles.dot, { backgroundColor: c.success }]} />
            ) : (
              <Icon name={log.direction === "outgoing" ? "arrow-up-outline" : "arrow-down-outline"} size={13} color={color} />
            )}
            <Text style={{ fontSize: 13, color, marginLeft: 4, flex: 1 }} numberOfLines={1}>
              {status}
            </Text>
          </View>
          {/* Always the full date and time, e.g. "Nov 20, 2026 · 6:45 PM". */}
          <Text muted style={{ fontSize: 12, marginTop: 2 }}>
            {formatDateTime(log.createdAt)}
          </Text>
        </View>
        <IconButton
          name={log.video ? "videocam-outline" : "call-outline"}
          color={c.primary}
          label={log.isGroup ? `Open ${name} to call` : busy ? "You're already in a call" : `${log.video ? "Video" : "Voice"} call ${name}`}
          disabled={!log.isGroup && !canRedial}
          onPress={() => (log.isGroup ? openChat(log.chatId) : redial(log))}
        />
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TabHeader title="Calls" />
      <OfflineBanner />
      {logs == null ? (
        failed ? (
          <View style={{ alignItems: "center", paddingTop: 64 }}>
            <Text>Couldn't load your calls.</Text>
            <Button title="Try again" variant="outline" compact onPress={load} style={{ marginTop: 12 }} />
          </View>
        ) : (
          <View style={{ paddingTop: 48 }}>
            <Spinner />
          </View>
        )
      ) : (
        <FlashList
          data={logs}
          renderItem={renderItem}
          keyExtractor={(l) => l.id}
          extraData={[busy, chatsById]}
          ItemSeparatorComponent={() => <Divider inset={78} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} colors={[c.primary]} />}
          ListEmptyComponent={
            <View style={{ alignItems: "center", paddingTop: 72, paddingHorizontal: 32 }}>
              <View style={[styles.emptyIcon, { backgroundColor: `${c.primary}1F` }]}>
                <Icon name="call-outline" color={c.primary} />
              </View>
              <Text style={{ fontWeight: "600", marginTop: 12 }}>No recent calls</Text>
              <Text muted style={{ fontSize: 13, marginTop: 4, textAlign: "center" }}>
                Calls you make or receive will show up here.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  dot: { width: 7, height: 7, borderRadius: 4, marginHorizontal: 3 },
  emptyIcon: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
});
