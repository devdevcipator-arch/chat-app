import 'config.dart';

// Media rules shared with the web app (web/src/lib/media.ts, vault.ts,
// chat-upload.ts) and the `media_url_is_object_key` check in the database.

enum UploadKind { image, audio, video, file }

class MediaType {
  const MediaType(this.mime, this.ext, this.kind);
  final String mime;
  final String ext;
  final UploadKind kind;

  /// The chat `message_type` this upload becomes.
  String get messageType => switch (kind) {
        UploadKind.image => 'image',
        UploadKind.audio => 'audio',
        UploadKind.video => 'video',
        UploadKind.file => 'file',
      };
}

const _types = <String, MediaType>{
  'jpg': MediaType('image/jpeg', 'jpg', UploadKind.image),
  'jpeg': MediaType('image/jpeg', 'jpg', UploadKind.image),
  'png': MediaType('image/png', 'png', UploadKind.image),
  'webp': MediaType('image/webp', 'webp', UploadKind.image),
  'gif': MediaType('image/gif', 'gif', UploadKind.image),
  'mp4': MediaType('video/mp4', 'mp4', UploadKind.video),
  'm4v': MediaType('video/mp4', 'mp4', UploadKind.video),
  'mov': MediaType('video/quicktime', 'mov', UploadKind.video),
  'webm': MediaType('video/webm', 'webm', UploadKind.video),
  'mp3': MediaType('audio/mpeg', 'mp3', UploadKind.audio),
  'm4a': MediaType('audio/mp4', 'm4a', UploadKind.audio),
  'aac': MediaType('audio/aac', 'aac', UploadKind.audio),
  'ogg': MediaType('audio/ogg', 'ogg', UploadKind.audio),
  'oga': MediaType('audio/ogg', 'ogg', UploadKind.audio),
  'wav': MediaType('audio/wav', 'wav', UploadKind.audio),
  'pdf': MediaType('application/pdf', 'pdf', UploadKind.file),
  'txt': MediaType('text/plain', 'txt', UploadKind.file),
  'csv': MediaType('text/csv', 'csv', UploadKind.file),
  'zip': MediaType('application/zip', 'zip', UploadKind.file),
  'docx': MediaType('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx', UploadKind.file),
  'xlsx': MediaType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx', UploadKind.file),
  'pptx': MediaType('application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx', UploadKind.file),
};

/// Extensions the document picker offers.
const pickableDocumentExtensions = ['pdf', 'txt', 'csv', 'zip', 'docx', 'xlsx', 'pptx', 'mp3', 'm4a', 'aac', 'ogg', 'wav'];

String extensionOf(String name) {
  final dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.substring(dot + 1).toLowerCase();
}

/// The canonical type a file uploads as (by extension), or null if unsupported.
MediaType? mediaTypeFor(String fileName) => _types[extensionOf(fileName)];

/// Upper bounds enforced by /api/media/upload-url (chat) and the gallery.
int chatUploadLimit(MediaType type) => switch (type.kind) {
      // Chat images must be re-encoded small; the server hard-caps at 2 MB.
      UploadKind.image => 2 * 1024 * 1024,
      UploadKind.audio => 10 * 1024 * 1024,
      UploadKind.video => 100 * 1024 * 1024,
      UploadKind.file => 25 * 1024 * 1024,
    };

/// Chat accepts only JPEG/PNG/WebP images (GIFs arrive by forwarding from the gallery).
bool chatAcceptsImage(MediaType type) =>
    type.kind != UploadKind.image || type.mime != 'image/gif';

int galleryUploadLimit(MediaType type) => switch (type.kind) {
      UploadKind.image => 20 * 1024 * 1024,
      UploadKind.video => 100 * 1024 * 1024,
      UploadKind.audio || UploadKind.file => 25 * 1024 * 1024,
    };

final _objectKey = RegExp(
  r'^(chats/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}|vault/[0-9a-f-]{36}/[0-9a-f-]{36}|avatars/[0-9a-f-]{36}/[0-9a-f-]{36})\.[a-z0-9]{2,5}$',
);

/// Public URL for one of our R2 object keys; null for anything else.
String? mediaPublicUrl(String? key) {
  if (key == null || !_objectKey.hasMatch(key)) return null;
  final base = AppConfig.r2PublicBase.trim().replaceAll(RegExp(r'/+$'), '');
  if (base.isEmpty) return null;
  return '${base.startsWith('http') ? base : 'https://$base'}/$key';
}

String formatBytes(int bytes) {
  if (bytes < 1024) return '$bytes B';
  const units = ['KB', 'MB', 'GB'];
  var value = bytes / 1024;
  var unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return '${value < 10 ? value.toStringAsFixed(1) : value.round()} ${units[unit]}';
}

/// Seconds as "MM:SS".
String formatDuration(num totalSeconds) {
  final secs = totalSeconds.floor().clamp(0, 1 << 31);
  return '${(secs ~/ 60).toString().padLeft(2, '0')}:${(secs % 60).toString().padLeft(2, '0')}';
}
