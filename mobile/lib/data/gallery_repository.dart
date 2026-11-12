import 'dart:io';

import '../core/api.dart';
import '../core/media.dart';
import '../core/supabase.dart';
import '../models/chat_message.dart';
import '../models/gallery_item.dart';

/// The personal gallery (vault): rows are read under RLS, while uploads,
/// deletes and forwards go through /api/gallery so R2 stays consistent.
abstract final class GalleryRepository {
  static Future<List<GalleryItem>> list() async {
    final rows = await supabase.from('user_gallery').select().order('created_at', ascending: false);
    return rows.map(GalleryItem.fromMap).toList();
  }

  /// upload-url → PUT to R2 → POST /api/gallery to save the row.
  static Future<GalleryItem> upload(
    File file,
    String fileName, {
    void Function(double fraction)? onProgress,
  }) async {
    final type = mediaTypeFor(fileName);
    if (type == null) throw const ApiException("That file type isn't supported.");
    final size = await file.length();
    if (size == 0) throw const ApiException('That file is empty.');
    final limit = galleryUploadLimit(type);
    if (size > limit) throw ApiException('That file is too large (max ${formatBytes(limit)}).');

    final target = await Api.post('/api/gallery/upload-url', {
      'fileName': fileName,
      'fileType': type.mime,
      'fileSize': size,
    });
    await Api.uploadFile(
      uploadUrl: target['uploadUrl'] as String,
      headers: stringMap(target['headers']),
      file: file,
      length: size,
      onProgress: onProgress,
    );
    final saved = await Api.post('/api/gallery', {
      'fileId': target['fileId'],
      'fileName': fileName,
      'fileType': target['fileType'] ?? type.mime,
    });
    return GalleryItem(
      id: saved['id'] as String,
      key: saved['key'] as String,
      fileName: saved['fileName'] as String,
      kind: saved['kind'] as String,
      size: (saved['size'] as num).toInt(),
      createdAt: DateTime.parse(saved['createdAt'] as String),
    );
  }

  /// Permanently deletes the item (R2 object, then the row).
  static Future<void> delete(String id) => Api.delete('/api/gallery/$id');

  /// Copies the item into a chat and posts it as a message.
  static Future<ChatMessage> forward(String id, String chatId) async {
    final row = await Api.post('/api/gallery/$id/forward', {'chatId': chatId});
    return ChatMessage.fromMap(row);
  }
}
