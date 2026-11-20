import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import { memo, useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Cache } from "../../data/cache";
import { GalleryRepo } from "../../data/gallery";
import { iconForFile } from "../../lib/media";
import { type GalleryItem, galleryFromRow, galleryUrl } from "../../models/types";
import { useAuth } from "../../state/auth";
import { Center, Icon, IconButton, Spinner } from "../../ui/components";
import { Text } from "../../ui/Text";
import { usePalette } from "../../ui/theme";

export function useGalleryItems() {
  const meId = useAuth((s) => s.userId)!;
  const [items, setItems] = useState<GalleryItem[] | null>(() => {
    const rows = Cache.rows(meId, "gallery");
    try {
      return rows ? rows.map(galleryFromRow) : null;
    } catch {
      return null;
    }
  });
  const [error, setError] = useState<string | null>(null);

  const save = (next: GalleryItem[]) => {
    setItems(next);
    Cache.saveRows(
      meId,
      "gallery",
      next.map((i) => ({ id: i.id, media_url: i.key, file_name: i.fileName, file_type: i.kind, file_size: i.size, created_at: i.createdAt })),
    );
  };

  const load = async () => {
    try {
      save(await GalleryRepo.list());
      setError(null);
    } catch {
      setError("Couldn't load your gallery.");
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { items, error, load, save };
}

/** Square thumbnail for a gallery item (shared with the gallery screen). */
export const GalleryThumb = memo(function GalleryThumb({
  item,
  size,
  onPress,
  onLongPress,
}: {
  item: GalleryItem;
  size: number;
  onPress?: () => void;
  onLongPress?: () => void;
}) {
  const c = usePalette();
  const url = galleryUrl(item);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={item.fileName}
      style={[styles.thumb, { width: size, height: size, backgroundColor: c.surfaceHigh }]}
    >
      {item.kind === "image" && url ? (
        <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" recyclingKey={url} />
      ) : (
        <View style={{ alignItems: "center", padding: 8 }}>
          <Icon
            name={item.kind === "video" ? "play-circle-outline" : item.kind === "audio" ? "musical-notes-outline" : iconForFile(item.fileName)}
            size={34}
            color={c.primary}
          />
          <Text numberOfLines={2} style={{ fontSize: 11, textAlign: "center", marginTop: 6 }}>
            {item.fileName}
          </Text>
        </View>
      )}
    </Pressable>
  );
});

/** Pick an item from my gallery to send into the current chat. */
export function GalleryPicker({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (item: GalleryItem) => void }) {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { items, error } = useGalleryItems();
  const columns = width < 380 ? 3 : 4;
  const size = Math.floor((width - 24 - (columns - 1) * 8) / columns);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: 8 }}>
        <View style={styles.header}>
          <Text style={{ fontSize: 18, fontWeight: "600", flex: 1 }}>From my Gallery</Text>
          <IconButton name="close" label="Close" onPress={onClose} />
        </View>
        {items == null ? (
          <Center>{error ? <Text>{error}</Text> : <Spinner />}</Center>
        ) : items.length === 0 ? (
          <Center>
            <Text muted style={{ textAlign: "center" }}>
              Your gallery is empty.{"\n"}Add files from Settings → Gallery.
            </Text>
          </Center>
        ) : (
          <FlashList
            data={items}
            numColumns={columns}
            keyExtractor={(i) => i.id}
            contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 12 }}
            renderItem={({ item }) => (
              <View style={{ padding: 4 }}>
                <GalleryThumb item={item} size={size - 8} onPress={() => onPick(item)} />
              </View>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 8 },
  thumb: { borderRadius: 12, overflow: "hidden", alignItems: "center", justifyContent: "center" },
});
