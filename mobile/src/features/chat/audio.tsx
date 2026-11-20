import { type AudioPlayer, type AudioStatus, createAudioPlayer, setAudioModeAsync } from "expo-audio";
import { type ReactNode, memo, useMemo, useRef } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { create } from "zustand";
import { formatDuration } from "../../lib/media";
import { Icon, Spinner } from "../../ui/components";
import { Text } from "../../ui/Text";

// ---------------------------------------------------------------------------
// One app-wide player: only one clip plays at a time, and a long chat list
// never creates a native player per bubble.
// ---------------------------------------------------------------------------

type NowPlaying = {
  id: string | null;
  playing: boolean;
  loading: boolean;
  error: string | null;
  position: number;
  duration: number;
};

export const useNowPlaying = create<NowPlaying>(() => ({
  id: null,
  playing: false,
  loading: false,
  error: null,
  position: 0,
  duration: 0,
}));

let player: AudioPlayer | null = null;
let modeSet = false;

function onStatus(status: AudioStatus) {
  const finished = status.didJustFinish;
  useNowPlaying.setState({
    playing: finished ? false : status.playing,
    loading: !status.isLoaded || (status.isBuffering && !status.playing && status.currentTime === 0),
    position: finished ? 0 : status.currentTime,
    duration: status.duration || useNowPlaying.getState().duration,
  });
  if (finished) {
    void player?.seekTo(0);
    player?.pause();
  }
}

export const AudioPlayback = {
  async toggle(id: string, uri: string, onFirstPlay?: () => void) {
    if (!modeSet) {
      modeSet = true;
      await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false }).catch(() => {});
    }
    const now = useNowPlaying.getState();
    if (now.id === id && player) {
      if (now.playing) player.pause();
      else player.play();
      return;
    }
    try {
      if (!player) {
        player = createAudioPlayer({ uri }, { updateInterval: 200 });
        player.addListener("playbackStatusUpdate", onStatus);
      } else {
        player.pause();
        player.replace({ uri });
      }
      useNowPlaying.setState({ id, playing: true, loading: true, error: null, position: 0, duration: 0 });
      player.play();
      onFirstPlay?.();
    } catch {
      useNowPlaying.setState({ id, playing: false, loading: false, error: "Couldn't play" });
    }
  },
  seek(id: string, fraction: number) {
    const now = useNowPlaying.getState();
    if (now.id !== id || !player || !now.duration) return;
    void player.seekTo(Math.max(0, Math.min(1, fraction)) * now.duration);
  },
  stop() {
    player?.pause();
    useNowPlaying.setState({ id: null, playing: false, position: 0 });
  },
};

/** Deterministic pseudo-waveform for a clip (the server stores no amplitude data). */
export function waveformFor(id: string, bars = 30): number[] {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const v = ((h >>> 0) % 1000) / 1000;
    const envelope = 0.55 + 0.45 * Math.sin((i / bars) * Math.PI);
    out.push(0.18 + 0.82 * v * envelope);
  }
  return out;
}

export function Waveform({
  levels,
  progress,
  color,
  height = 28,
  onSeek,
}: {
  levels: number[];
  progress: number;
  color: string;
  height?: number;
  onSeek?: (fraction: number) => void;
}) {
  const filled = Math.round(progress * levels.length);
  const body = (
    <View style={[styles.wave, { height }]}>
      {levels.map((l, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            marginHorizontal: 1,
            borderRadius: 2,
            height: Math.max(3, l * height),
            backgroundColor: color,
            opacity: i < filled ? 1 : 0.38,
          }}
        />
      ))}
    </View>
  );
  if (!onSeek) return body;
  return <SeekArea onSeek={onSeek}>{body}</SeekArea>;
}

function SeekArea({ onSeek, children }: { onSeek: (fraction: number) => void; children: ReactNode }) {
  const width = useRef(1);
  return (
    <Pressable
      onLayout={(e) => {
        width.current = Math.max(1, e.nativeEvent.layout.width);
      }}
      onPressIn={(e) => onSeek(e.nativeEvent.locationX / width.current)}
      accessibilityRole="adjustable"
      accessibilityLabel="Seek"
    >
      {children}
    </Pressable>
  );
}

/** Voice note / voicemail / audio file player bubble content. */
export const AudioBubble = memo(function AudioBubble({
  id,
  uri,
  durationSeconds,
  color,
  onFirstPlay,
}: {
  id: string;
  uri: string | null;
  durationSeconds: number | null;
  color: string;
  onFirstPlay?: () => void;
}) {
  const active = useNowPlaying((s) => s.id === id);
  const playing = useNowPlaying((s) => s.id === id && s.playing);
  const loading = useNowPlaying((s) => s.id === id && s.loading && s.playing);
  const position = useNowPlaying((s) => (s.id === id ? s.position : 0));
  const duration = useNowPlaying((s) => (s.id === id && s.duration ? s.duration : 0)) || durationSeconds || 0;
  const error = useNowPlaying((s) => (s.id === id ? s.error : null));
  const levels = useMemo(() => waveformFor(id), [id]);
  const progress = duration > 0 ? Math.min(1, position / duration) : 0;

  return (
    <View style={styles.audio}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={playing ? "Pause" : "Play"}
        disabled={!uri}
        onPress={() => uri && void AudioPlayback.toggle(id, uri, onFirstPlay)}
        hitSlop={8}
        style={styles.playButton}
      >
        {loading ? (
          <Spinner />
        ) : (
          <Icon name={error ? "refresh" : playing ? "pause" : "play"} size={26} color={color} />
        )}
      </Pressable>
      <View style={{ width: 170 }}>
        <Waveform levels={levels} progress={progress} color={color} onSeek={active ? (f) => AudioPlayback.seek(id, f) : undefined} />
      </View>
      <Text style={{ color, fontSize: 12, marginLeft: 8, fontVariant: ["tabular-nums"] }}>
        {error ? "Error" : formatDuration(active && position > 0 ? position : duration)}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  wave: { flexDirection: "row", alignItems: "center" },
  audio: { flexDirection: "row", alignItems: "center", paddingVertical: 2 },
  playButton: { width: 36, height: 36, alignItems: "center", justifyContent: "center", marginRight: 4 },
});
