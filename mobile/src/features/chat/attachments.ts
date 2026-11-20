import * as DocumentPicker from "expo-document-picker";
import { SaveFormat, manipulateAsync } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { fileSize } from "../../data/upload";

export type PickedFile = { uri: string; name: string; size: number | null };

const CHAT_IMAGE_MAX = 2 * 1024 * 1024;

/** Re-encodes a photo to a JPEG small enough for the 2 MB chat image cap. */
export async function compressForChat(asset: { uri: string; width: number; height: number }): Promise<PickedFile> {
  for (const [edge, quality] of [
    [1600, 0.8],
    [1280, 0.6],
    [1024, 0.5],
  ] as const) {
    const longest = Math.max(asset.width, asset.height);
    const resize =
      longest > edge ? [{ resize: asset.width >= asset.height ? { width: edge } : { height: edge } }] : [];
    const out = await manipulateAsync(asset.uri, resize, { compress: quality, format: SaveFormat.JPEG });
    const size = await fileSize(out.uri);
    if (size > 0 && size <= CHAT_IMAGE_MAX) return { uri: out.uri, name: "photo.jpg", size };
  }
  throw new Error("That photo is too large to send.");
}

/** Square-ish avatar, ≤ 512 px, well under the 1 MB avatar cap. */
export async function compressAvatar(asset: { uri: string; width: number; height: number }): Promise<PickedFile> {
  const resize = Math.max(asset.width, asset.height) > 512 ? [{ resize: asset.width >= asset.height ? { width: 512 } : { height: 512 } }] : [];
  const out = await manipulateAsync(asset.uri, resize, { compress: 0.85, format: SaveFormat.JPEG });
  return { uri: out.uri, name: "avatar.jpg", size: await fileSize(out.uri) };
}

export async function pickPhoto(source: "camera" | "library") {
  const perm =
    source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error("Permission denied.");
  const result =
    source === "camera"
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
  return result.canceled ? null : result.assets[0];
}

export async function pickVideo(): Promise<PickedFile | null> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["videos"], quality: 1 });
  if (result.canceled) return null;
  const a = result.assets[0];
  const ext = a.uri.split(".").pop()?.toLowerCase();
  const name = a.fileName ?? `video.${ext && ext.length <= 4 ? ext : "mp4"}`;
  return { uri: a.uri, name, size: a.fileSize ?? (await fileSize(a.uri)) };
}

/** Photos and videos from the device library, several at once (gallery uploads). */
export async function pickMedia(): Promise<PickedFile[]> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], allowsMultipleSelection: true, quality: 0.9 });
  if (result.canceled) return [];
  return Promise.all(
    result.assets.map(async (a, i) => ({
      uri: a.uri,
      name: a.fileName ?? `${a.type === "video" ? "video" : "photo"}-${Date.now()}-${i}.${a.type === "video" ? "mp4" : "jpg"}`,
      size: a.fileSize ?? (await fileSize(a.uri)),
    })),
  );
}

/**
 * Any format (EPUB, PDF, ZIP, office…): the picker is never restricted by a
 * MIME list, because Android reports many documents as
 * application/octet-stream. Executables are refused later, by extension.
 */
export async function pickFiles(multiple = false): Promise<PickedFile[]> {
  const result = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true, multiple });
  if (result.canceled) return [];
  return Promise.all(
    result.assets.map(async (a) => ({ uri: a.uri, name: a.name, size: a.size ?? (await fileSize(a.uri)) })),
  );
}
