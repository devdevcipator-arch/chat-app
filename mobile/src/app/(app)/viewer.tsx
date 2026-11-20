import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { openExternally } from "../../features/chat/MessageBubble";
import { VideoView } from "../../features/VideoView";
import { IconButton } from "../../ui/components";
import { Text } from "../../ui/Text";

/**
 * Full-screen image (pinch-to-zoom here only; the rest of the UI is zoom-locked)
 * or video viewer.
 */
export default function Viewer() {
  const { kind, uri, title } = useLocalSearchParams<{ kind: "image" | "video"; uri: string; title?: string }>();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const remote = uri?.startsWith("http");

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <View style={[styles.bar, { paddingTop: insets.top + 4 }]}>
        <IconButton name="close" color="#fff" label="Close" onPress={() => router.back()} />
        <Text style={{ color: "#fff", flex: 1, marginHorizontal: 8, fontWeight: "600" }} numberOfLines={1}>
          {title ?? ""}
        </Text>
        {remote ? <IconButton name="open-outline" color="#fff" label="Open in browser" onPress={() => openExternally(uri)} /> : null}
      </View>
      {kind === "video" ? (
        <View style={{ flex: 1, paddingBottom: insets.bottom }}>
          <VideoView uri={uri} />
        </View>
      ) : (
        <ScrollView
          maximumZoomScale={5}
          minimumZoomScale={1}
          centerContent
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}
        >
          <Image source={{ uri }} style={{ width, height: height - insets.top - 56 }} contentFit="contain" cachePolicy="memory-disk" />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingBottom: 8, zIndex: 2 },
});
