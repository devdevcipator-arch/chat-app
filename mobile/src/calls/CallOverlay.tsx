import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatDuration } from "../lib/media";
import { avatarImageUrl, profileName } from "../models/types";
import { Calls, type RemoteParticipant, currentEngine, loadAgora, useCall } from "../state/calls";
import { Messages } from "../state/messages";
import { Avatar, Icon, type IconName, Spinner } from "../ui/components";
import { Text } from "../ui/Text";
import { useScale } from "../ui/theme";
import { VoiceRecorder } from "../features/chat/VoiceRecorder";

/** Full-screen call UI, shown above everything while a call exists. */
export default function CallOverlay() {
  const st = useCall();
  const insets = useSafeAreaInsets();
  const { s } = useScale();
  const [, tick] = useState(0);
  const [recordingVoicemail, setRecordingVoicemail] = useState(false);
  const [voicemailState, setVoicemailState] = useState<"idle" | "sending" | "error">("idle");
  const [voicemailError, setVoicemailError] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  if (st.phase === "idle") return null;
  const isGroup = !!st.groupTitle;
  const title = isGroup ? st.groupTitle! : profileName(st.peer);
  const live = st.phase === "active" || st.phase === "group" || st.phase === "connecting";
  const showVideo = st.isVideo && live && st.channelName != null && currentEngine() != null;

  const status = (() => {
    switch (st.phase) {
      case "starting":
        return "Starting…";
      case "outgoing":
        return "Ringing…";
      case "incoming":
        return `Incoming ${st.isVideo ? "Video" : "Voice"} Call`;
      case "connecting":
        return "Connecting…";
      case "active":
      case "group": {
        if (st.reconnecting) return "Reconnecting…";
        if (!st.connectedAt) return isGroup ? "Joining…" : "Connecting…";
        // Joined, but the other side's audio hasn't arrived yet.
        if (!isGroup && st.remotes.length === 0) return `Waiting for ${title}…`;
        const elapsed = formatDuration((Date.now() - st.connectedAt) / 1000);
        return isGroup ? `${elapsed} · ${st.remotes.length + 1} in call` : elapsed;
      }
      case "ended":
        return st.endMessage ?? "Call ended";
      default:
        return "";
    }
  })();

  const sendVoicemail = async (uri: string, seconds: number) => {
    const chatId = st.chatId;
    setRecordingVoicemail(false);
    if (!chatId) return;
    setVoicemailState("sending");
    setVoicemailError(null);
    const error = Messages.sendFile(
      chatId,
      { uri, name: "voicemail.m4a" },
      { durationSeconds: Math.min(120, Math.max(1, seconds)), messageType: "voicemail", callId: st.voicemailCallId },
    );
    if (error) {
      setVoicemailState("error");
      setVoicemailError(error);
      return;
    }
    // Queued in the outbox (it delivers offline-safe, like any message).
    Calls.dismiss();
  };

  // A native Modal is its own window: above every route, sheet and keyboard.
  // The back button never drops a live call; it only closes the "ended" screen.
  return (
    <Modal
      visible
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => {
        if (useCall.getState().phase === "ended") Calls.dismiss();
      }}
    >
    <View style={[StyleSheet.absoluteFill, styles.root]} accessibilityViewIsModal>
      {showVideo ? <VideoStage /> : null}
      <View style={{ flex: 1, paddingTop: insets.top + s(32), paddingBottom: insets.bottom + s(28) }}>
        <View style={{ alignItems: "center", paddingHorizontal: 24 }}>
          {!showVideo || st.remotes.length === 0 ? (
            <View style={{ marginBottom: s(20) }}>
              <Avatar name={title} uri={isGroup ? null : avatarImageUrl(st.peer)} group={isGroup} size={s(112)} />
            </View>
          ) : null}
          <Text style={{ color: "#fff", fontSize: s(26), fontWeight: "600", textAlign: "center" }} numberOfLines={2}>
            {title}
          </Text>
          <Text style={{ color: "#ffffffb3", fontSize: 15, marginTop: 6, textAlign: "center" }}>{status}</Text>
          {isGroup && !st.isVideo && st.remotes.length ? (
            <View style={styles.people}>
              {st.remotes.map((r) => {
                const p = Calls.profileFor(r);
                return (
                  <View key={r.uid} style={{ alignItems: "center", width: 72 }}>
                    <Avatar name={p ? profileName(p) : "?"} uri={avatarImageUrl(p)} size={56} />
                    <Text style={{ color: "#ffffffb3", fontSize: 12, marginTop: 4 }} numberOfLines={1}>
                      {p ? profileName(p) : "Joining…"}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : null}
        </View>
        <View style={{ flex: 1 }} />
        {st.phase === "incoming" ? (
          <View style={styles.row}>
            <RoundButton icon="call" color="#EF4444" label="Decline" onPress={() => void Calls.decline()} rotate large />
            <RoundButton
              icon={st.isVideo ? "videocam" : "call"}
              color="#22C55E"
              label="Accept"
              onPress={() => void Calls.accept()}
              large
            />
          </View>
        ) : st.phase === "ended" ? (
          recordingVoicemail ? (
            <VoiceRecorder
              dark
              maxSeconds={120}
              onCancel={() => setRecordingVoicemail(false)}
              onDone={(rec) => void sendVoicemail(rec.uri, rec.seconds)}
            />
          ) : (
            <View>
              {voicemailError ? (
                <Text style={{ color: "#F87171", textAlign: "center", marginBottom: 12 }}>{voicemailError}</Text>
              ) : null}
              {voicemailState === "sending" ? (
                <View style={{ marginBottom: 12 }}>
                  <Spinner />
                </View>
              ) : null}
              <View style={styles.row}>
                {st.offerVoicemail && voicemailState !== "sending" ? (
                  <RoundButton icon="recording-outline" color="#FF5722" label="Voicemail" onPress={() => setRecordingVoicemail(true)} />
                ) : null}
                <RoundButton icon="close" color="#ffffff3d" label="Close" onPress={Calls.dismiss} />
              </View>
            </View>
          )
        ) : (
          <View style={[styles.row, { flexWrap: "wrap", rowGap: 16 }]}>
            {live ? (
              <RoundButton
                icon={st.micMuted ? "mic-off" : "mic"}
                color={st.micMuted ? "#fff" : "#ffffff3d"}
                iconColor={st.micMuted ? "#000" : "#fff"}
                label={st.micMuted ? "Unmute" : "Mute"}
                onPress={Calls.toggleMic}
              />
            ) : null}
            {live && st.isVideo ? (
              <RoundButton
                icon={st.cameraOff ? "videocam-off" : "videocam"}
                color={st.cameraOff ? "#fff" : "#ffffff3d"}
                iconColor={st.cameraOff ? "#000" : "#fff"}
                label="Camera"
                onPress={Calls.toggleCamera}
              />
            ) : null}
            {live && st.isVideo ? <RoundButton icon="camera-reverse" color="#ffffff3d" label="Flip" onPress={Calls.switchCamera} /> : null}
            {live ? (
              <RoundButton
                icon={st.speakerOn ? "volume-high" : "ear"}
                color={st.speakerOn ? "#fff" : "#ffffff3d"}
                iconColor={st.speakerOn ? "#000" : "#fff"}
                label="Speaker"
                onPress={Calls.toggleSpeaker}
              />
            ) : null}
            <RoundButton icon="call" color="#EF4444" label={isGroup ? "Leave" : "End"} onPress={() => void Calls.hangUp()} rotate />
          </View>
        )}
      </View>
    </View>
    </Modal>
  );
}

/** Agora video tiles: 1 remote = full screen + picture-in-picture self view; more = a grid. */
function VideoStage() {
  const A = loadAgora();
  const st = useCall();
  const { width } = useWindowDimensions();
  const channelId = st.channelName!;
  const local = st.cameraOff ? (
    <View style={[StyleSheet.absoluteFill, styles.tileOff]}>
      <Icon name="videocam-off" color="#ffffff88" />
    </View>
  ) : (
    <A.RtcSurfaceView key={`local-${st.engineGen}`} style={StyleSheet.absoluteFill} canvas={{ uid: 0 }} />
  );
  const remote = (r: RemoteParticipant) =>
    r.videoOff ? (
      <View style={[StyleSheet.absoluteFill, styles.tileOff, { backgroundColor: "#141414" }]}>
        <Avatar name={profileName(Calls.profileFor(r))} uri={avatarImageUrl(Calls.profileFor(r))} size={64} />
      </View>
    ) : (
      <A.RtcSurfaceView
        key={`remote-${st.engineGen}-${r.uid}`}
        style={StyleSheet.absoluteFill}
        canvas={{ uid: r.uid }}
        connection={{ channelId }}
      />
    );

  if (st.remotes.length === 0) return <View style={StyleSheet.absoluteFill}>{local}</View>;
  if (st.remotes.length === 1) {
    return (
      <View style={StyleSheet.absoluteFill}>
        {remote(st.remotes[0])}
        <View style={[styles.pip, { width: Math.min(120, width * 0.3), height: Math.min(170, width * 0.42) }]}>{local}</View>
      </View>
    );
  }
  const tiles = [local, ...st.remotes.map(remote)];
  const tileW = (width - 8) / 2;
  return (
    <View style={[StyleSheet.absoluteFill, styles.grid]}>
      {tiles.map((t, i) => (
        <View key={i} style={{ width: tileW, height: tileW * 1.33, margin: 2, borderRadius: 8, overflow: "hidden" }}>
          {t}
        </View>
      ))}
    </View>
  );
}

function RoundButton({
  icon,
  color,
  label,
  onPress,
  iconColor = "#fff",
  rotate,
  large,
}: {
  icon: IconName;
  color: string;
  label: string;
  onPress: () => void;
  iconColor?: string;
  rotate?: boolean;
  /** Accept / Decline: bigger, unmistakable targets. */
  large?: boolean;
}) {
  const size = large ? 76 : 64;
  return (
    <View style={{ alignItems: "center", width: large ? 110 : 76 }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [
          styles.round,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        <View style={rotate ? { transform: [{ rotate: "135deg" }] } : undefined}>
          <Icon name={icon} size={large ? 34 : 28} color={iconColor} />
        </View>
      </Pressable>
      <Text style={{ color: large ? "#fff" : "#ffffffb3", fontSize: large ? 15 : 12, fontWeight: large ? "600" : "400", marginTop: 8 }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: "#0A0A0A", zIndex: 100, elevation: 100 },
  row: { flexDirection: "row", justifyContent: "space-evenly", alignItems: "center", paddingHorizontal: 12 },
  people: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 16, marginTop: 24 },
  round: { alignItems: "center", justifyContent: "center" },
  tileOff: { alignItems: "center", justifyContent: "center", backgroundColor: "#1F1F1F" },
  pip: { position: "absolute", right: 16, bottom: 150, borderRadius: 12, overflow: "hidden", backgroundColor: "#1F1F1F" },
  grid: { flexDirection: "row", flexWrap: "wrap", paddingTop: 140, paddingHorizontal: 2, alignContent: "flex-start" },
});
