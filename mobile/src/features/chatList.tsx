import { FlashList } from "@shopify/flash-list";
import { router } from "expo-router";
import { type ReactNode, memo, useCallback, useEffect, useMemo, useState } from "react";
import { Keyboard, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChatRepo } from "../data/chats";
import { ProfileRepo } from "../data/profiles";
import { chatActionError, isOfflineError } from "../lib/errors";
import { formatListTime, plural } from "../lib/format";
import { usernameQuery } from "../lib/username";
import {
  type ChatSummary,
  type GroupSearchResult,
  type Profile,
  avatarImageUrl,
  chatMatches,
  chatName,
  lastActivity,
  messageSnippet,
  profileName,
} from "../models/types";
import { useAuth } from "../state/auth";
import { Chats, useChats } from "../state/chats";
import { Avatar, Badge, Button, Divider, Icon, IconButton, OfflineBanner, SectionHeader, Spinner, toast } from "../ui/components";
import { confirm, showActions } from "../ui/sheets";
import { Text, TextInput } from "../ui/Text";
import { usePalette, useScale } from "../ui/theme";

export const openChat = (chatId: string) => router.push({ pathname: "/chat/[id]", params: { id: chatId } });

// ---------------------------------------------------------------------------
// Tab header (title + profile avatar → Settings)
// ---------------------------------------------------------------------------

export function TabHeader({ title, action }: { title: string; action?: ReactNode }) {
  const c = usePalette();
  const { s } = useScale();
  const insets = useSafeAreaInsets();
  const me = useAuth((st) => st.profile);
  return (
    <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + s(10), paddingHorizontal: s(16), backgroundColor: c.bg }]}>
      <Text style={{ fontSize: s(28), fontWeight: "700", flex: 1 }} accessibilityRole="header" numberOfLines={1}>
        {title}
      </Text>
      {action}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Settings"
        onPress={() => router.push("/settings")}
        hitSlop={8}
        style={{ marginLeft: 8 }}
      >
        <Avatar name={profileName(me)} uri={avatarImageUrl(me)} size={s(34)} />
      </Pressable>
    </View>
  );
}

export function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const c = usePalette();
  const { s } = useScale();
  return (
    <View style={[styles.search, { backgroundColor: c.surface, marginHorizontal: s(16), marginTop: s(8), marginBottom: s(12) }]}>
      <Icon name="search" size={18} color={c.muted} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        clearButtonMode="never"
        style={styles.searchInput}
        accessibilityLabel={placeholder}
      />
      {value ? <IconButton name="close-circle" size={18} color={c.muted} label="Clear search" onPress={() => onChange("")} /> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// One conversation row
// ---------------------------------------------------------------------------

export const ChatRow = memo(function ChatRow({ chat, meId }: { chat: ChatSummary; meId: string }) {
  const c = usePalette();
  const { s } = useScale();
  const last = chat.lastMessage;
  const unread = chat.unreadCount > 0;
  const name = chatName(chat);
  let snippet: string;
  if (!last) snippet = chat.type === "group" ? plural(chat.memberCount, "member") : "No messages yet";
  else {
    const prefix =
      last.type === "system"
        ? ""
        : last.senderId === meId
          ? "You: "
          : chat.type === "group" && last.senderName
            ? `${last.senderName}: `
            : "";
    snippet = `${prefix}${messageSnippet(last.type, last.content, last.durationSeconds)}`;
  }

  return (
    <Pressable
      onPress={() => openChat(chat.chatId)}
      onLongPress={() => chatActions(chat)}
      accessibilityRole="button"
      accessibilityLabel={`${name}${unread ? `, ${chat.unreadCount} unread` : ""}`}
      style={({ pressed }) => [styles.row, { paddingHorizontal: s(16), paddingVertical: 13 }, pressed && { backgroundColor: c.surface }]}
    >
      <Avatar name={name} uri={chat.type === "group" ? null : avatarImageUrl(chat.other)} group={chat.type === "group"} size={48} />
      <View style={{ flex: 1, marginLeft: s(14), minWidth: 0 }}>
        <View style={styles.rowLine}>
          <Text style={[styles.rowTitle, unread && { fontWeight: "700" }]} numberOfLines={1}>
            {name}
          </Text>
          {chat.isMuted ? <Icon name="notifications-off" size={14} color={c.muted} /> : null}
          <Text style={{ fontSize: 12, marginLeft: 8, color: unread && !chat.isMuted ? c.primary : c.muted }}>
            {formatListTime(lastActivity(chat))}
          </Text>
        </View>
        <View style={[styles.rowLine, { marginTop: 3 }]}>
          <Text
            style={[{ flex: 1, fontSize: 14, color: unread ? c.text : c.muted }, unread && { fontWeight: "500" }]}
            numberOfLines={1}
          >
            {snippet}
          </Text>
          <Badge count={chat.unreadCount} muted={chat.isMuted} />
        </View>
      </View>
    </Pressable>
  );
});

function chatActions(chat: ChatSummary) {
  const group = chat.type === "group";
  showActions({
    title: chatName(chat),
    actions: [
      {
        label: chat.isMuted ? "Unmute" : "Mute notifications",
        icon: chat.isMuted ? "notifications-outline" : "notifications-off-outline",
        onPress: async () => {
          try {
            await ChatRepo.setMuted(chat.chatId, !chat.isMuted);
            Chats.patch(chat.chatId, { isMuted: !chat.isMuted });
          } catch (e) {
            toast(chatActionError(e));
          }
        },
      },
      {
        label: group ? "Leave group" : "Delete conversation",
        icon: group ? "exit-outline" : "trash-outline",
        destructive: true,
        onPress: async () => {
          const ok = await confirm(
            group ? `Leave ${chatName(chat)}?` : "Delete conversation?",
            group ? "You won't get new messages from this group." : "It disappears from your list. A new message brings it back.",
            group ? "Leave" : "Delete",
          );
          if (!ok) return;
          try {
            await (group ? ChatRepo.leaveGroup(chat.chatId) : ChatRepo.hideChat(chat.chatId));
            Chats.remove(chat.chatId);
          } catch (e) {
            toast(chatActionError(e));
          }
        },
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// The Chats / Groups tab body
// ---------------------------------------------------------------------------

export function ChatListScreen({ groupsOnly }: { groupsOnly: boolean }) {
  const c = usePalette();
  const meId = useAuth((st) => st.userId)!;
  const chats = useChats((st) => st.chats);
  const loading = useChats((st) => st.loading);
  const error = useChats((st) => st.error);
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const list = useMemo(() => (groupsOnly ? chats.filter((ch) => ch.type === "group") : chats), [chats, groupsOnly]);
  const q = query.trim();

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Chats.refresh();
    setRefreshing(false);
  }, []);

  const renderItem = useCallback(({ item }: { item: ChatSummary }) => <ChatRow chat={item} meId={meId} />, [meId]);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TabHeader
        title={groupsOnly ? "Groups" : "Chats"}
        action={
          groupsOnly ? <IconButton name="add-circle-outline" label="New group" onPress={() => router.push("/new-group")} /> : null
        }
      />
      <OfflineBanner />
      <SearchBar
        value={query}
        onChange={setQuery}
        placeholder={groupsOnly ? "Search groups…" : "Search chats, groups or @username…"}
      />
      {q ? (
        <SearchResults query={q} chats={list} meId={meId} groupsOnly={groupsOnly} onDone={() => setQuery("")} />
      ) : loading && list.length === 0 ? (
        <View style={{ paddingTop: 48 }}>
          <Spinner />
        </View>
      ) : (
        <FlashList
          data={list}
          renderItem={renderItem}
          keyExtractor={(item) => item.chatId}
          ItemSeparatorComponent={() => <Divider inset={78} />}
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} colors={[c.primary]} />}
          ListEmptyComponent={
            <View style={{ paddingHorizontal: 32, paddingTop: 64, alignItems: "center" }}>
              <Text muted style={{ textAlign: "center", lineHeight: 22 }}>
                {error && list.length === 0
                  ? error
                  : groupsOnly
                    ? "No groups yet.\nTap + to create one, or search to find one."
                    : "No conversations yet.\nSearch for an @username to start one."}
              </Text>
              {error ? <Button title="Retry" variant="outline" compact onPress={onRefresh} style={{ marginTop: 12 }} /> : null}
            </View>
          }
        />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Search: my groups + direct chats (instant, local, offline), then
// "Discover Groups" (search_groups RPC) and "Find People" (@username).
// ---------------------------------------------------------------------------

function SearchResults({
  query,
  chats,
  meId,
  groupsOnly,
  onDone,
}: {
  query: string;
  chats: ChatSummary[];
  meId: string;
  groupsOnly: boolean;
  onDone: () => void;
}) {
  const matches = useMemo(() => chats.filter((ch) => chatMatches(ch, query)), [chats, query]);
  const groups = matches.filter((ch) => ch.type === "group");
  const directs = groupsOnly ? [] : matches.filter((ch) => ch.type !== "group");
  const username = groupsOnly ? null : usernameQuery(query);
  const known = useMemo(() => new Set(chats.map((ch) => ch.chatId)), [chats]);

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={{ paddingBottom: 48 }}
    >
      {groups.length ? <SectionHeader title="Your Groups" count={groups.length} /> : null}
      {groups.map((ch) => (
        <ChatRow key={ch.chatId} chat={ch} meId={meId} />
      ))}
      {directs.length ? <SectionHeader title="Direct Chats" count={directs.length} /> : null}
      {directs.map((ch) => (
        <ChatRow key={ch.chatId} chat={ch} meId={meId} />
      ))}
      {!groups.length && !directs.length && !username ? (
        <Text muted style={{ textAlign: "center", padding: 32, paddingBottom: 8 }}>
          {groupsOnly ? "None of your groups match." : "No matching chats or groups."}
        </Text>
      ) : null}
      <DiscoverGroups query={query} known={known} onJoined={onDone} />
      {username ? (
        <>
          <SectionHeader title="Find People (@username)" />
          <PeopleLookup username={username} meId={meId} onStarted={onDone} />
        </>
      ) : null}
    </ScrollView>
  );
}

function DiscoverGroups({ query, known, onJoined }: { query: string; known: Set<string>; onJoined: () => void }) {
  const c = usePalette();
  const term = query.replace(/^@/, "").trim();
  const [results, setResults] = useState<{ for: string; groups: GroupSearchResult[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState<string | null>(null);

  useEffect(() => {
    if (term.length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const groups = await ChatRepo.searchGroups(term);
        if (!cancelled) {
          setResults({ for: term, groups });
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(isOfflineError(e) ? "You're offline. Connect to discover groups." : "Group search failed. Try again.");
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [term]);

  if (term.length < 2) return null;
  const shown = (results?.groups ?? []).filter((g) => !known.has(g.id));
  const loading = results?.for !== term;

  const join = async (group: GroupSearchResult) => {
    Keyboard.dismiss();
    setJoining(group.id);
    setError(null);
    try {
      const chatId = await ChatRepo.joinGroup(group.id);
      Chats.addJoinedGroup(chatId, group);
      Chats.refreshSoon();
      onJoined();
      openChat(chatId);
    } catch (e) {
      setError(isOfflineError(e) ? "You're offline. Connect to join groups." : chatActionError(e));
    } finally {
      setJoining(null);
    }
  };

  return (
    <View accessibilityLiveRegion="polite">
      <SectionHeader title="Discover Groups" count={shown.length || undefined} />
      {loading && !shown.length && !error ? (
        <View style={styles.inline}>
          <Spinner />
          <Text muted style={{ marginLeft: 12 }}>
            Searching groups for “{term}”…
          </Text>
        </View>
      ) : error && !shown.length ? (
        <Text style={[styles.inline, { color: c.error }]}>{error}</Text>
      ) : !shown.length ? (
        <Text muted style={styles.inline}>
          No other groups match “{term}”.
        </Text>
      ) : null}
      {shown.map((g) => (
        <Pressable
          key={g.id}
          onPress={() => void join(g)}
          disabled={!!joining}
          style={({ pressed }) => [styles.row, { paddingHorizontal: 16, paddingVertical: 10 }, pressed && { backgroundColor: c.surface }]}
        >
          <Avatar name={g.title} group size={46} />
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {g.title}
            </Text>
            <Text muted style={{ fontSize: 13 }}>
              {plural(g.memberCount, "member")}
            </Text>
          </View>
          {joining === g.id ? (
            <Spinner />
          ) : (
            <Button
              title={g.isMember ? "Open" : "Join"}
              variant={g.isMember ? "outline" : "filled"}
              compact
              disabled={!!joining}
              onPress={() => void join(g)}
            />
          )}
        </Pressable>
      ))}
      {error && shown.length ? <Text style={{ color: c.error, paddingHorizontal: 16 }}>{error}</Text> : null}
    </View>
  );
}

type Lookup = { state: "searching" } | { state: "found"; profile: Profile } | { state: "self" } | { state: "none" } | { state: "failed"; message: string };

function PeopleLookup({ username, meId, onStarted }: { username: string; meId: string; onStarted: () => void }) {
  const c = usePalette();
  const [result, setResult] = useState<Lookup>({ state: "searching" });
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setResult({ state: "searching" });
    const t = setTimeout(async () => {
      let next: Lookup;
      try {
        const p = await ProfileRepo.findByUsername(username);
        next = !p ? { state: "none" } : p.id === meId ? { state: "self" } : { state: "found", profile: p };
      } catch (e) {
        next = { state: "failed", message: isOfflineError(e) ? "You're offline. Connect to find new people." : "Search failed. Try again." };
      }
      if (!cancelled) setResult(next);
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [username, meId]);

  const start = async (p: Profile) => {
    setStarting(true);
    try {
      const chatId = await ChatRepo.createDirectChat(p.id);
      Chats.refreshSoon();
      onStarted();
      openChat(chatId);
    } catch (e) {
      setResult({
        state: "failed",
        message: (e as { code?: string }).code === "P0002" ? "That user no longer exists." : "Couldn't start the chat. Please try again.",
      });
    } finally {
      setStarting(false);
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: c.surface }]} accessibilityLiveRegion="polite">
      {result.state === "searching" ? (
        <View style={styles.inline}>
          <Spinner />
          <Text style={{ marginLeft: 12 }}>Looking up @{username}…</Text>
        </View>
      ) : result.state === "none" ? (
        <Text muted style={styles.inline}>
          No one goes by @{username}.
        </Text>
      ) : result.state === "self" ? (
        <Text muted style={styles.inline}>
          That's you.
        </Text>
      ) : result.state === "failed" ? (
        <Text style={[styles.inline, { color: c.error }]}>{result.message}</Text>
      ) : (
        <View style={[styles.row, { padding: 12 }]}>
          <Avatar name={profileName(result.profile)} uri={avatarImageUrl(result.profile)} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {profileName(result.profile)}
            </Text>
            <Text muted style={{ fontSize: 13 }}>
              @{result.profile.username}
            </Text>
          </View>
          <Button title="Start chat" compact loading={starting} onPress={() => void start(result.profile)} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingBottom: 6 },
  search: { flexDirection: "row", alignItems: "center", borderRadius: 12, paddingLeft: 12, height: 44 },
  searchInput: { flex: 1, height: "100%", marginLeft: 8, fontSize: 15 },
  row: { flexDirection: "row", alignItems: "center" },
  rowLine: { flexDirection: "row", alignItems: "center", gap: 4 },
  rowTitle: { flex: 1, fontSize: 16, fontWeight: "500" },
  inline: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12 },
  card: { marginHorizontal: 12, borderRadius: 14, overflow: "hidden" },
});
