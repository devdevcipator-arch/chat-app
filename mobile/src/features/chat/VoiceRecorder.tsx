import {
  AudioModule,
  IOSOutputFormat,
  AudioQuality,
  type RecordingOptions,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { formatDuration } from "../../lib/media";
import { Button, IconButton } from "../../ui/components";
import { Text } from "../../ui/Text";
import { usePalette } from "../../ui/theme";
import { Waveform } from "./audio";

/** AAC in an .m4a container: uploads as audio/mp4, plays everywhere (web included). */
const OPTIONS: RecordingOptions = {
  extension: ".m4a",
  sampleRate: 44100,
  numberOfChannels: 1,
  bitRate: 64000,
  isMeteringEnabled: true,
  android: { outputFormat: "mpeg4", audioEncoder: "aac" },
  ios: { outputFormat: IOSOutputFormat.MPEG4AAC, audioQuality: AudioQuality.HIGH, linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false },
  web: { mimeType: "audio/webm", bitsPerSecond: 64000 },
};

export type Recording = { uri: string; seconds: number };

const BARS = 34;

/**
 * Inline recorder that replaces the composer while recording a voice note (or
 * a voicemail). Starts as soon as it's shown; Pause / Resume; live waveform
 * from the microphone level.
 */
export function VoiceRecorder({
  onDone,
  onCancel,
  maxSeconds = 300,
  sendLabel = "Send",
  dark,
}: {
  onDone: (rec: Recording) => void;
  onCancel: () => void;
  maxSeconds?: number;
  sendLabel?: string;
  dark?: boolean;
}) {
  const c = usePalette();
  const recorder = useAudioRecorder(OPTIONS);
  const state = useAudioRecorderState(recorder, 100);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const levels = useRef<number[]>(Array(BARS).fill(0.08));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        if (!cancelled) setError("Microphone access is needed to record.");
        return;
      }
      try {
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        if (cancelled) return;
        recorder.record();
        setStarted(true);
      } catch {
        if (!cancelled) setError("Couldn't start recording.");
      }
    })();
    return () => {
      cancelled = true;
      void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // dBFS (-160..0) → 0..1, pushed into the rolling waveform while recording.
  if (state.isRecording && typeof state.metering === "number") {
    const level = Math.min(1, Math.max(0.06, (state.metering + 50) / 50));
    const next = levels.current.slice(1);
    next.push(level);
    levels.current = next;
  }

  const seconds = Math.floor((state.durationMillis ?? 0) / 1000);

  const finish = async () => {
    if (finishing) return;
    setFinishing(true);
    const millis = state.durationMillis ?? 0;
    try {
      await recorder.stop();
    } catch {}
    const uri = recorder.uri;
    if (!uri || millis < 1000) {
      setError("Hold on a little longer — recordings must be at least 1 second.");
      setFinishing(false);
      return;
    }
    onDone({ uri, seconds: Math.min(maxSeconds, Math.max(1, Math.round(millis / 1000))) });
  };

  useEffect(() => {
    if (started && seconds >= maxSeconds) void finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds, started, maxSeconds]);

  const cancel = async () => {
    try {
      await recorder.stop();
    } catch {}
    onCancel();
  };

  const togglePause = () => {
    if (paused) recorder.record();
    else recorder.pause();
    setPaused(!paused);
  };

  const fg = dark ? "#fff" : c.text;

  return (
    <View style={[styles.bar, { borderTopColor: c.border, backgroundColor: dark ? "transparent" : c.bg }]}>
      <IconButton name="trash-outline" color={c.error} label="Discard recording" onPress={cancel} />
      {error ? (
        <Text style={{ flex: 1, color: c.error, fontSize: 13 }}>{error}</Text>
      ) : (
        <>
          <View style={[styles.dot, { backgroundColor: paused ? c.muted : "#EF4444" }]} />
          <Text style={{ color: fg, fontVariant: ["tabular-nums"], fontSize: 13, width: 92 }}>
            {formatDuration(seconds)} / {formatDuration(maxSeconds)}
          </Text>
          <View style={{ flex: 1, marginHorizontal: 6 }}>
            <Waveform levels={levels.current} progress={1} color={paused ? c.muted : c.primary} height={26} />
          </View>
          <IconButton
            name={paused ? "mic" : "pause"}
            label={paused ? "Resume recording" : "Pause recording"}
            onPress={togglePause}
            disabled={!started}
            color={fg}
          />
        </>
      )}
      {!error ? (
        <Button title={sendLabel} icon="send" compact loading={finishing} disabled={!started} onPress={finish} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  dot: { width: 10, height: 10, borderRadius: 5, marginHorizontal: 6 },
});
