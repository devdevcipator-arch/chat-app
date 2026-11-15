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

/// Never accepted: Windows executables, installers and script hosts. Same
/// list as web/src/lib/file-types.ts and the database key checks.
const blockedExtensions = {
  'exe', 'bat', 'cmd', 'com', 'scr', 'msi', 'msp', 'pif', 'cpl', 'dll', //
  'vbs', 'vbe', 'js', 'jse', 'ws', 'wsf', 'wsh', 'ps1', 'hta', 'reg', 'lnk', 'jar',
};

/// Content-Types for well-known documents, ebooks and archives; any other
/// extension is stored as application/octet-stream (downloads, never renders).
const documentMimeTypes = <String, String>{
  'epub': 'application/epub+zip',
  'mobi': 'application/x-mobipocket-ebook',
  'azw3': 'application/vnd.amazon.ebook',
  'fb2': 'application/x-fictionbook+xml',
  'djvu': 'image/vnd.djvu',
  'cbz': 'application/vnd.comicbook+zip',
  'cbr': 'application/vnd.comicbook-rar',
  'pdf': 'application/pdf',
  'doc': 'application/msword',
  'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'odt': 'application/vnd.oasis.opendocument.text',
  'rtf': 'application/rtf',
  'txt': 'text/plain',
  'md': 'text/markdown',
  'xls': 'application/vnd.ms-excel',
  'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'ods': 'application/vnd.oasis.opendocument.spreadsheet',
  'csv': 'text/csv',
  'ppt': 'application/vnd.ms-powerpoint',
  'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'odp': 'application/vnd.oasis.opendocument.presentation',
  'key': 'application/vnd.apple.keynote',
  'zip': 'application/zip',
  'rar': 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  'tar': 'application/x-tar',
  'gz': 'application/gzip',
  'json': 'application/json',
};

final _extensionPattern = RegExp(r'^[a-z0-9]{1,10}$');

/// "Book.EPUB" -> "epub"; "" when there is no usable extension.
String extensionOf(String name) {
  final dot = name.lastIndexOf('.');
  if (dot <= 0 || dot == name.length - 1) return '';
  final ext = name.substring(dot + 1).toLowerCase();
  return _extensionPattern.hasMatch(ext) ? ext : '';
}

bool isBlockedExtension(String ext) => blockedExtensions.contains(ext.toLowerCase());

/// How a file uploads (by extension), or null for executables.
///
/// Known media keep their kind; anything else (EPUB, office files, archives,
/// any other format) becomes a document under its own extension. The file
/// picker's MIME type is never trusted: Android reports most documents as
/// application/octet-stream, and the server re-resolves from the name anyway.
MediaType? mediaTypeFor(String fileName) {
  final ext = extensionOf(fileName);
  if (isBlockedExtension(ext)) return null;
  final known = _types[ext];
  if (known != null) return known;
  return MediaType(documentMimeTypes[ext] ?? 'application/octet-stream', ext.isEmpty ? 'bin' : ext, UploadKind.file);
}

/// Upper-case format badge for file cards: "EPUB", "PDF", "ZIP", or "FILE".
String formatBadge(String? fileName) {
  final ext = extensionOf(fileName ?? '');
  if (ext.isEmpty) return 'FILE';
  return ext.length > 5 ? ext.substring(0, 5).toUpperCase() : ext.toUpperCase();
}

/// Upper bounds enforced by /api/media/upload-url (chat) and the gallery.
int chatUploadLimit(MediaType type) => switch (type.kind) {
      // Chat images must be re-encoded small; the server hard-caps at 2 MB.
      UploadKind.image => 2 * 1024 * 1024,
      UploadKind.audio => 10 * 1024 * 1024,
      UploadKind.video => 100 * 1024 * 1024,
      UploadKind.file => 25 * 1024 * 1024,
    };

/// How a picked file is sent into a chat. Chat images must be JPEG/PNG/WebP
/// (re-encoded small); a GIF or other media picked as a file goes as a file
/// card, the same rule as the server (web/src/lib/chat-upload.ts).
MediaType? chatUploadTypeFor(String fileName) {
  final type = mediaTypeFor(fileName);
  if (type == null) return null;
  final playable = switch (type.kind) {
    UploadKind.image => type.mime != 'image/gif',
    UploadKind.audio => const {'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/webm'}.contains(type.mime),
    UploadKind.video || UploadKind.file => true,
  };
  return playable ? type : MediaType(type.mime, type.ext, UploadKind.file);
}

int galleryUploadLimit(MediaType type) => switch (type.kind) {
      UploadKind.image => 20 * 1024 * 1024,
      UploadKind.video => 100 * 1024 * 1024,
      UploadKind.audio || UploadKind.file => 25 * 1024 * 1024,
    };

final _objectKey = RegExp(
  r'^(chats/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}|vault/[0-9a-f-]{36}/[0-9a-f-]{36}|avatars/[0-9a-f-]{36}/[0-9a-f-]{36})\.([a-z0-9]{1,10})$',
);

/// Public URL for one of our R2 object keys; null for anything else.
String? mediaPublicUrl(String? key) {
  final match = key == null ? null : _objectKey.firstMatch(key);
  if (match == null || isBlockedExtension(match.group(2)!)) return null;
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
