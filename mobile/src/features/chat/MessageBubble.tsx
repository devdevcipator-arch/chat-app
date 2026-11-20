import * as Clipboard from "expo-clipboard";
import { Image } from "expo-image";
import { router } from "expo-router";
import { memo, useEffect, useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { formatDateTime, formatMessageTime } from "../../lib/format";
import { parseMathResultMessage } from "../../lib/math";
import { formatBadge, formatBytes, iconForFile } from "../../lib/media";
import { type ChatMessage, isCallReceipt, isMediaMessage, messagePublicUrl } from "../../models/types";
import { Icon } from "../../ui/components";
import { Text } from "../../ui/Text";
import { type Palette, usePalette } from "../../ui/theme";
import { AudioBubble } from "./audio";

export const openExternally = (url: string) => void Linking.openURL(url).catch(() => {});

type Props = {
  message: ChatMessage;
  mine: boolean;
  grouped: boolean;
  senderName: string | null;
  onLongPress: (m: ChatMessage) => void;
  onRetry: (m: ChatMessage) => void;
  onVoicemailPlayed: (m: ChatMessage) => void;
};

export const MessageBubble = memo(function MessageBubble({
  message,
  mine,
  grouped,
  senderName,
  onLongPress,
  onRetry,
  onVoicemailPlayed,
}: Props) {
  const c = usePalette();

  if (isCallReceipt(message)) {
    // "📞 Voice call · 01:23" with the full date and time beside it.
    return (
      <View style={styles.centerRow}>
        <View style={[styles.receipt, { backgroundColor: c.surfaceHigh }]}>
          <Text style={{ fontSize: 12.5, fontWeight: "500" }}>{message.content}</Text>
          <Text muted style={{ fontSize: 12 }}>
            {formatDateTime(message.createdAt)}
          </Text>
        </View>
      </View>
    );
  }
  if (message.type === "system") {
    return (
      <Text muted style={styles.system}>
        {message.content}
      </Text>
    );
  }

  const fg = mine ? "#fff" : c.text;
  const isImage = message.type === "image";
  const radius = {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: mine ? 18 : 6,
    borderBottomRightRadius: mine ? 6 : 18,
  };

  return (
    <View style={[styles.wrap, { paddingTop: grouped ? 2 : 10, alignItems: mine ? "flex-end" : "flex-start" }]}>
      {senderName ? <Text style={[styles.sender, { color: c.primary }]}>{senderName}</Text> : null}
      <Pressable
        onLongPress={message.status === "sent" ? () => onLongPress(message) : undefined}
        delayLongPress={300}
        style={[
          styles.bubble,
          radius,
          { backgroundColor: mine ? c.bubbleMine : c.bubbleTheirs, opacity: message.status === "sending" ? 0.8 : 1 },
          isImage ? { padding: 3 } : { paddingHorizontal: 14, paddingVertical: 9 },
        ]}
      >
        <Content message={message} mine={mine} fg={fg} c={c} onVoicemailPlayed={onVoicemailPlayed} />
      </Pressable>
      <Status message={message} c={c} onRetry={onRetry} />
    </View>
  );
});

function Status({ message, c, onRetry }: { message: ChatMessage; c: Palette; onRetry: (m: ChatMessage) => void }) {
  if (message.status === "sending") {
    const uploading = isMediaMessage(message) && message.progress != null && message.progress > 0;
    return (
      <View style={styles.status}>
        <Icon name="time-outline" size={12} color={c.muted} />
        <Text muted style={styles.statusText}>
          {uploading ? `Uploading ${Math.round((message.progress ?? 0) * 100)}%` : "Sending…"}
        </Text>
      </View>
    );
  }
  if (message.status === "failed") {
    return (
      <View style={styles.status}>
        <Icon name="alert-circle-outline" size={13} color={c.error} />
        <Text style={[styles.statusText, { color: c.error, flexShrink: 1 }]} numberOfLines={2}>
          {message.error ?? "Not sent"}
        </Text>
        <Pressable onPress={() => onRetry(message)} hitSlop={8} accessibilityRole="button">
          <Text style={{ color: c.primary, fontWeight: "600", fontSize: 12.5, marginLeft: 8 }}>Retry</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <Text muted style={[styles.statusText, styles.status]}>
      {formatMessageTime(message.createdAt)}
      {message.editedAt ? " · (edited)" : ""}
    </Text>
  );
}

function Content({
  message,
  mine,
  fg,
  c,
  onVoicemailPlayed,
}: {
  message: ChatMessage;
  mine: boolean;
  fg: string;
  c: Palette;
  onVoicemailPlayed: (m: ChatMessage) => void;
}) {
  const url = messagePublicUrl(message);
  const local = message.localUri ?? null;
  switch (message.type) {
    case "text": {
      const math = parseMathResultMessage(message.content);
      if (math) return <MathCard expression={math.expression} result={math.result} mine={mine} fg={fg} c={c} />;
      // flexShrink + the bubble's maxWidth wrap long unbroken URLs onto the next line.
      return (
        <Text style={[styles.text, { color: fg }]} selectable={false} textBreakStrategy="simple">
          {message.content}
        </Text>
      );
    }
    case "image":
      return <ImageContent uri={local ?? url} remote={url} fg={fg} />;
    case "video":
      return (
        <FileCard
          icon="play-circle"
          name={message.content ?? "Video"}
          size={null}
          mine={mine}
          fg={fg}
          c={c}
          action="play"
          onPress={
            url || local
              ? () => router.push({ pathname: "/viewer", params: { kind: "video", uri: local ?? url!, title: message.content ?? "" } })
              : undefined
          }
        />
      );
    case "audio":
    case "voicemail": {
      const voicemail = message.type === "voicemail";
      const label = mine
        ? `Voicemail${message.voicemailPlayedAt ? " · Played" : ""}`
        : message.voicemailPlayedAt
          ? "Voicemail"
          : "New voicemail";
      return (
        <View>
          {voicemail ? (
            <View style={[styles.row, { marginBottom: 2, marginLeft: 2 }]}>
              <Icon name="recording-outline" size={16} color={fg} />
              <Text style={{ color: fg, fontWeight: "600", fontSize: 13, marginLeft: 6 }}>{label}</Text>
            </View>
          ) : null}
          <AudioBubble
            id={message.id}
            uri={local ?? url}
            durationSeconds={message.durationSeconds}
            color={fg}
            onFirstPlay={voicemail ? () => onVoicemailPlayed(message) : undefined}
          />
        </View>
      );
    }
    case "file":
      return (
        <FileCard
          icon={iconForFile(message.content ?? "")}
          name={message.content ?? "File"}
          size={message.fileSize}
          mine={mine}
          fg={fg}
          c={c}
          action="download"
          onPress={url ? () => openExternally(url) : undefined}
        />
      );
    default:
      return <Text style={{ color: fg, fontStyle: "italic" }}>Unsupported message</Text>;
  }
}

/** Bubble image: aspect ratio from the decoded image, memory + disk cached. */
function ImageContent({ uri, remote, fg }: { uri: string | null; remote: string | null; fg: string }) {
  const [aspect, setAspect] = useState(1);
  const [failed, setFailed] = useState(false);
  if (!uri || failed) {
    return (
      <View style={[styles.unavailable]}>
        <Icon name="image-outline" color={fg} />
        <Text style={{ color: fg, marginTop: 4 }}>{uri ? "Image unavailable" : "Image"}</Text>
      </View>
    );
  }
  const width = 240;
  const height = Math.max(120, Math.min(320, width / aspect));
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/viewer", params: { kind: "image", uri: remote ?? uri } })}
      accessibilityRole="imagebutton"
      accessibilityLabel="Photo, tap to open"
    >
      <Image
        source={{ uri }}
        style={{ width, height, borderRadius: 15 }}
        contentFit="cover"
        cachePolicy="memory-disk"
        recyclingKey={uri}
        transition={120}
        onLoad={(e) => {
          const { width: w, height: h } = e.source;
          if (w && h) setAspect(w / h);
        }}
        onError={() => setFailed(true)}
      />
    </Pressable>
  );
}

/** File attachment card: icon with a format badge (EPUB, PDF, ZIP…), name, size, action button. */
function FileCard({
  icon,
  name,
  size,
  mine,
  fg,
  c,
  action,
  onPress,
}: {
  icon: string;
  name: string;
  size: number | null;
  mine: boolean;
  fg: string;
  c: Palette;
  action: "download" | "play";
  onPress?: () => void;
}) {
  const badge = formatBadge(name);
  const details = [badge === "FILE" ? "File" : `${badge} file`, size != null ? formatBytes(size) : null].filter(Boolean).join(" · ");
  const tile = mine ? "rgba(255,255,255,0.18)" : c.bg;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${details}${onPress ? ", tap to open" : ", unavailable"}`}
      style={[styles.row, { width: 236 }]}
    >
      <View style={[styles.fileIcon, { backgroundColor: tile }]}>
        <Icon name={icon} size={20} color={fg} />
        <View style={[styles.fileBadge, { backgroundColor: mine ? "#fff" : c.primary }]}>
          <Text style={{ fontSize: 8.5, fontWeight: "800", color: mine ? c.primary : "#fff" }} allowFontScaling={false}>
            {badge}
          </Text>
        </View>
      </View>
      <View style={{ flex: 1, marginHorizontal: 10 }}>
        <Text style={{ color: fg, fontWeight: "600", lineHeight: 19 }} numberOfLines={2}>
          {name}
        </Text>
        <Text style={{ color: fg, opacity: 0.75, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
          {onPress ? details : "File unavailable"}
        </Text>
      </View>
      {onPress ? (
        <View style={[styles.fileAction, { backgroundColor: tile }]}>
          <Icon name={action === "play" ? "play" : "download-outline"} size={18} color={fg} />
        </View>
      ) : null}
    </Pressable>
  );
}

/** Answer to a `/math` command (mirrors web math-result-card.tsx). */
function MathCard({ expression, result, mine, fg, c }: { expression: string; result: string; mine: boolean; fg: string; c: Palette }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const copy = async () => {
    // The bare number pastes better into other apps than "1,234.5".
    await Clipboard.setStringAsync(result.replace(/,/g, ""));
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };
  return (
    <View style={{ minWidth: 170 }}>
      <View style={[styles.mathBadge, { backgroundColor: mine ? "rgba(255,255,255,0.2)" : `${c.primary}24` }]}>
        <Text style={{ color: mine ? "#fff" : c.primary, fontSize: 11, fontWeight: "700" }}>🧮 Math</Text>
      </View>
      <Text style={{ color: fg, opacity: 0.75, fontFamily: "monospace", fontSize: 13, marginTop: 6 }}>{expression}</Text>
      <View style={[styles.row, { marginTop: 2 }]}>
        <Text style={{ color: fg, fontSize: 24, fontWeight: "700", flexShrink: 1, fontVariant: ["tabular-nums"] }}>
          <Text style={{ color: fg, opacity: 0.6, fontSize: 24 }}>= </Text>
          {result}
        </Text>
        <Pressable
          onPress={copy}
          accessibilityRole="button"
          accessibilityLabel={copied ? "Copied" : `Copy result ${result}`}
          style={[styles.copy, { backgroundColor: mine ? "rgba(255,255,255,0.15)" : c.bg }]}
        >
          <Icon name={copied ? "checkmark" : "copy-outline"} size={14} color={mine ? "#fff" : c.muted} />
          <Text style={{ color: mine ? "#fff" : c.muted, fontSize: 12, marginLeft: 4 }}>{copied ? "Copied" : "Copy"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%" },
  // maxWidth + flexShrink: long unbroken strings wrap instead of overflowing.
  bubble: { maxWidth: "78%", flexShrink: 1, overflow: "hidden" },
  text: { fontSize: 15.5, lineHeight: 21, flexShrink: 1 },
  sender: { fontSize: 12, fontWeight: "600", marginLeft: 6, marginBottom: 2 },
  status: { flexDirection: "row", alignItems: "center", marginTop: 2, marginHorizontal: 4, maxWidth: "78%" },
  statusText: { fontSize: 11.5, marginLeft: 3 },
  centerRow: { alignItems: "center", paddingVertical: 8 },
  receipt: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    columnGap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    maxWidth: "90%",
  },
  system: { textAlign: "center", fontSize: 12, paddingVertical: 8, paddingHorizontal: 24 },
  row: { flexDirection: "row", alignItems: "center" },
  unavailable: { width: 200, height: 120, alignItems: "center", justifyContent: "center" },
  fileIcon: { width: 42, height: 50, borderRadius: 8, alignItems: "center", justifyContent: "space-evenly" },
  fileBadge: { paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4 },
  fileAction: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  mathBadge: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  copy: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, marginLeft: 12 },
});
