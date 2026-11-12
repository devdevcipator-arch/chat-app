import '../core/config.dart';
import '../core/media.dart';

enum MessageStatus { sent, sending, failed }

class ChatMessage {
  const ChatMessage({
    required this.id,
    required this.chatId,
    required this.senderId,
    required this.type,
    required this.content,
    required this.mediaUrl,
    required this.createdAt,
    this.durationSeconds,
    this.editedAt,
    this.callId,
    this.voicemailPlayedAt,
    this.status = MessageStatus.sent,
    this.localPath,
    this.progress,
    this.error,
  });

  final String id;
  final String chatId;
  final String? senderId;

  /// text | image | audio | video | file | voicemail | system
  final String type;
  final String? content;

  /// R2 object key (`chats/<chat>/<sender>/<uuid>.<ext>`).
  final String? mediaUrl;
  final DateTime createdAt;
  final int? durationSeconds;
  final DateTime? editedAt;
  final String? callId;
  final DateTime? voicemailPlayedAt;

  // Local-only, while sending.
  final MessageStatus status;
  final String? localPath;
  final double? progress;
  final String? error;

  String? get publicUrl => mediaPublicUrl(mediaUrl);
  bool get isEdited => editedAt != null;
  bool get isMedia => const {'image', 'audio', 'video', 'file', 'voicemail'}.contains(type);

  /// Whether [meId] may still edit this message (text, own, within 10 minutes).
  bool canEdit(String meId, {DateTime? now}) =>
      type == 'text' &&
      senderId == meId &&
      status == MessageStatus.sent &&
      (now ?? DateTime.now()).toUtc().difference(createdAt.toUtc()) < AppConfig.editWindow;

  static DateTime? _date(Object? v) => v is String ? DateTime.parse(v) : null;

  factory ChatMessage.fromMap(Map<String, dynamic> map) => ChatMessage(
        id: map['id'] as String,
        chatId: map['chat_id'] as String,
        senderId: map['sender_id'] as String?,
        type: map['message_type'] as String,
        content: map['content'] as String?,
        mediaUrl: map['media_url'] as String?,
        createdAt: DateTime.parse(map['created_at'] as String),
        durationSeconds: (map['duration_seconds'] as num?)?.toInt(),
        editedAt: _date(map['edited_at']),
        callId: map['call_id'] as String?,
        voicemailPlayedAt: _date(map['voicemail_played_at']),
      );

  ChatMessage copyWith({
    MessageStatus? status,
    double? progress,
    String? error,
    bool clearError = false,
    DateTime? voicemailPlayedAt,
  }) =>
      ChatMessage(
        id: id,
        chatId: chatId,
        senderId: senderId,
        type: type,
        content: content,
        mediaUrl: mediaUrl,
        createdAt: createdAt,
        durationSeconds: durationSeconds,
        editedAt: editedAt,
        callId: callId,
        voicemailPlayedAt: voicemailPlayedAt ?? this.voicemailPlayedAt,
        status: status ?? this.status,
        localPath: localPath,
        progress: progress ?? this.progress,
        error: clearError ? null : (error ?? this.error),
      );

  /// The server copy, keeping our local file so the bubble doesn't flicker.
  ChatMessage withLocalPath(String? path) => path == null
      ? this
      : ChatMessage(
          id: id,
          chatId: chatId,
          senderId: senderId,
          type: type,
          content: content,
          mediaUrl: mediaUrl,
          createdAt: createdAt,
          durationSeconds: durationSeconds,
          editedAt: editedAt,
          callId: callId,
          voicemailPlayedAt: voicemailPlayedAt,
          status: status,
          localPath: path,
          progress: progress,
          error: error,
        );
}

/// Short preview used in the chat list (mirrors web messageSnippet).
String messageSnippet(String type, String? content, [int? durationSeconds]) {
  switch (type) {
    case 'voicemail':
      return durationSeconds != null ? '🎙️ Voicemail · ${formatDuration(durationSeconds)}' : '🎙️ Voicemail';
    case 'image':
      return content != null && content.isNotEmpty ? '📷 $content' : '📷 Photo';
    case 'audio':
      return durationSeconds != null
          ? '🎤 Voice message · ${formatDuration(durationSeconds)}'
          : '🎤 Voice message';
    case 'video':
      return '🎬 Video';
    case 'file':
      return content != null && content.isNotEmpty ? '📎 $content' : '📎 File';
    default:
      return content ?? '';
  }
}

/// Insert or replace messages by id, keeping chronological order.
List<ChatMessage> mergeMessages(
  List<ChatMessage> current,
  Iterable<ChatMessage> incoming,
) {
  final byId = <String, ChatMessage>{for (final m in current) m.id: m};
  for (final m in incoming) {
    byId[m.id] = m.withLocalPath(m.localPath ?? byId[m.id]?.localPath);
  }
  return byId.values.toList()..sort((a, b) => a.createdAt.compareTo(b.createdAt));
}
