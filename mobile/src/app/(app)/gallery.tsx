import { FlashList } from "@shopify/flash-list";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { RefreshControl, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GalleryRepo } from "../../data/gallery";
import { AppError } from "../../lib/errors";
import { pickFiles, pickMedia, pickPhoto, type PickedFile } from "../../features/chat/attachments";
import { GalleryThumb, useGalleryItems } from "../../features/chat/GalleryPicker";
import { Button, Center, Spinner, toast } from "../../ui/components";
import { showActions } from "../../ui/sheets";
import { Text } from "../../ui/Text";
import { usePalette } from "../../ui/theme";
import { fileSize } from "../../data/upload";

/** The personal vault: upload, preview, delete (permanent) and forward to chats. */
export default function Gallery() {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { items, error, load, save } = useGalleryItems();
  const [uploads, setUploads] = useState<Record<string, { name: string; progress: number }>>({});
  const [refreshing, setRefreshing] = useState(false);
  const columns = width < 380 ? 3 : 4;
  const size = Math.floor((width - 24) / columns);

  // A delete/forward on the preview screen comes back here: refresh from cache + server.
  useFocusEffect(
    useCallback(() => {
      void load();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const upload = async (file: PickedFile) => {
    const key = `${file.name}#${Date.now()}#${Math.random()}`;
    setUploads((u) => ({ ...u, [key]: { name: file.name, progress: 0 } }));
    try {
      const size = file.size ?? (await fileSize(file.uri));
      const item = await GalleryRepo.upload(file.uri, file.name, size, (p) =>
        setUploads((u) => (u[key] ? { ...u, [key]: { ...u[key], progress: p } } : u)),
      );
      save([item, ...(items ?? [])]);
      void load();
    } catch (e) {
      toast(`${file.name}: ${e instanceof AppError ? e.message : "upload failed."}`);
    } finally {
      setUploads(({ [key]: _, ...rest }) => rest);
    }
  };

  const add = () =>
    showActions({
      title: "Add to gallery",
      actions: [
        {
          label: "Photos & videos",
          icon: "images-outline",
          onPress: () => void pickMedia().then((files) => files.forEach((f) => void upload(f))).catch(() => toast("Couldn't open the picker.")),
        },
        {
          label: "Take photo",
          icon: "camera-outline",
          onPress: () =>
            void pickPhoto("camera")
              .then(async (a) => a && upload({ uri: a.uri, name: a.fileName ?? `photo-${Date.now()}.jpg`, size: a.fileSize ?? null }))
              .catch(() => toast("Couldn't open the camera.")),
        },
        {
          label: "Files (any format)",
          icon: "document-attach-outline",
          onPress: () => void pickFiles(true).then((files) => files.forEach((f) => void upload(f))).catch(() => toast("Couldn't open the picker.")),
        },
      ],
    });

  const pending = Object.entries(uploads);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      {pending.map(([key, u]) => (
        <View key={key} style={[styles.upload, { borderBottomColor: c.border }]}>
          <Text numberOfLines={1} style={{ fontSize: 13 }}>
            Uploading {u.name}
          </Text>
          <View style={[styles.track, { backgroundColor: c.surfaceHigh }]}>
            <View style={{ width: `${Math.round(u.progress * 100)}%`, height: "100%", backgroundColor: c.primary }} />
          </View>
        </View>
      ))}
      {items == null ? (
        <Center>
          {error ? (
            <>
              <Text>{error}</Text>
              <Button title="Retry" variant="outline" compact onPress={load} style={{ marginTop: 12 }} />
            </>
          ) : (
            <Spinner />
          )}
        </Center>
      ) : (
        <FlashList
          data={items}
          numColumns={columns}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 96 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
              tintColor={c.primary}
              colors={[c.primary]}
            />
          }
          renderItem={({ item }) => (
            <View style={{ padding: 4 }}>
              <GalleryThumb
                item={item}
                size={size - 8}
                onPress={() => router.push({ pathname: "/gallery-item", params: { id: item.id } })}
              />
            </View>
          )}
          ListEmptyComponent={
            <Text muted style={{ textAlign: "center", paddingTop: 96, paddingHorizontal: 32, lineHeight: 22 }}>
              Your private gallery is empty.{"\n"}Upload photos, videos and documents to keep them here and send them to any chat.
            </Text>
          }
        />
      )}
      <View style={[styles.fab, { bottom: insets.bottom + 20 }]}>
        <Button title="Upload" icon="cloud-upload-outline" onPress={add} style={{ borderRadius: 28, paddingHorizontal: 22 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  upload: { paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  track: { height: 4, borderRadius: 2, overflow: "hidden", marginTop: 6 },
  fab: { position: "absolute", right: 20 },
});
