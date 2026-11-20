import { useVideoPlayer, VideoView as ExpoVideoView } from "expo-video";
import { StyleSheet } from "react-native";

/** Plays a video from a URL or local file with native controls. */
export function VideoView({ uri }: { uri: string }) {
  const player = useVideoPlayer({ uri }, (p) => {
    p.loop = false;
    p.play();
  });
  return <ExpoVideoView player={player} style={StyleSheet.absoluteFill} nativeControls contentFit="contain" allowsPictureInPicture={false} />;
}
