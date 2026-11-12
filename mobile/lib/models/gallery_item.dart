import '../core/media.dart';

/// One row of `user_gallery` (the personal vault).
class GalleryItem {
  const GalleryItem({
    required this.id,
    required this.key,
    required this.fileName,
    required this.kind,
    required this.size,
    required this.createdAt,
  });

  final String id;

  /// `vault/<userId>/<fileId>.<ext>`
  final String key;
  final String fileName;

  /// image | video | audio | document
  final String kind;
  final int size;
  final DateTime createdAt;

  String? get url => mediaPublicUrl(key);

  factory GalleryItem.fromMap(Map<String, dynamic> map) => GalleryItem(
        id: map['id'] as String,
        key: map['media_url'] as String,
        fileName: map['file_name'] as String,
        kind: switch (map['file_type']) {
          'image' => 'image',
          'video' => 'video',
          'audio' => 'audio',
          _ => 'document',
        },
        size: (map['file_size'] as num).toInt(),
        createdAt: DateTime.parse(map['created_at'] as String),
      );
}
