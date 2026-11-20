import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Cache } from "../../data/cache";
import { GalleryRepo } from "../../data/gallery";
import { AppError } from "../../lib/errors";
import { formatBytes, iconForFile } from "../../lib/media";
import { galleryFromRow, galleryUrl } from "../../models/types";
import { AudioBubble } from "../../features/chat/audio";
import { openExternally } from "../../features/chat/MessageBubble";
import { VideoView } from "../../features/VideoView";
import { useAuth } from "../../state/auth";
import { Button, Center, Icon, IconButton, toast } from "../../ui/components";
import { confirm } from "../../ui/sheets";
import { Text } from "../../ui/Text";

/** Full-screen preview of one gallery item: send to a chat, or delete permanently. */
export default function GalleryItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const meId = useAuth((s) => s.userId)!;
  const [deleting, setDeleting] = useState(false);
  const row = Cache.rows(meId, "gallery")?.find((r) => r.id === id);
  const item = row ? galleryFromRow(row) : null;
  const url = item ? galleryUrl(item) : null;

  if (!item) {
    return (
      <Center style={{ backgroundColor: "#000" }}>
        <Text style={{ color: "#fff" }}>This item is no longer in your gallery.</Text>
        <Button title="Close" variant="text" onPress={() => router.back()} />
      </Center>
    );
  }

  const remove = async () => {
    const ok = await confirm(
      "Delete from gallery?",
      `${item.fileName} is permanently deleted from your gallery and storage. Copies already sent to chats stay.`,
      "Delete",
    );
    if (!ok) return;
    setDeleting(true);
    try {
      await GalleryRepo.delete(item.id);
      Cache.saveRows(meId, "gallery", (Cache.rows(meId, "gallery") ?? []).filter((r) => r.id !== item.id));
      toast("Deleted");
      router.back();
    } catch (e) {
      setDeleting(false);
      toast(e instanceof AppError ? e.message : "Couldn't delete that item.");
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <View style={[styles.bar, { paddingTop: insets.top + 4 }]}>
        <IconButton name="close" color="#fff" label="Close" onPress={() => router.back()} />
        <View style={{ flex: 1, marginHorizontal: 8 }}>
          <Text style={{ color: "#fff", fontWeight: "600" }} numberOfLines={1}>
            {item.fileName}
          </Text>
          <Text style={{ color: "#ffffffaa", fontSize: 12 }}>{formatBytes(item.size)}</Text>
        </View>
        <IconButton
          name="send-outline"
          color="#fff"
          label="Send to chat"
          onPress={() => router.push({ pathname: "/forward", params: { id: item.id, name: item.fileName } })}
        />
        <IconButton name="trash-outline" color="#fff" label="Delete permanently" onPress={remove} disabled={deleting} />
      </View>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: insets.bottom }}>
        {!url ? (
          <Text style={{ color: "#ffffffaa" }}>Preview unavailable</Text>
        ) : item.kind === "image" ? (
          <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="contain" cachePolicy="memory-disk" />
        ) : item.kind === "video" ? (
          <VideoView uri={url} />
        ) : item.kind === "audio" ? (
          <View style={styles.audioCard}>
            <AudioBubble id={`gallery:${item.id}`} uri={url} durationSeconds={null} color="#fff" />
          </View>
        ) : (
          <View style={{ alignItems: "center" }}>
            <Icon name={iconForFile(item.fileName)} size={72} color="#ffffffcc" />
            <Button title="Open" icon="open-outline" onPress={() => openExternally(url)} style={{ marginTop: 16 }} />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingBottom: 8, zIndex: 2 },
  audioCard: { backgroundColor: "#1F1F1F", borderRadius: 18, padding: 14 },
});
