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
    this.status = MessageStatus.sent,
  });

  final String id;
  final String chatId;
  final String? senderId;
  final String type; // text | image | audio | file | system
  final String? content;
  final String? mediaUrl;
  final DateTime createdAt;
  final MessageStatus status;

  factory ChatMessage.fromMap(Map<String, dynamic> map) => ChatMessage(
        id: map['id'] as String,
        chatId: map['chat_id'] as String,
        senderId: map['sender_id'] as String?,
        type: map['message_type'] as String,
        content: map['content'] as String?,
        mediaUrl: map['media_url'] as String?,
        createdAt: DateTime.parse(map['created_at'] as String),
      );

  ChatMessage copyWith({MessageStatus? status}) => ChatMessage(
        id: id,
        chatId: chatId,
        senderId: senderId,
        type: type,
        content: content,
        mediaUrl: mediaUrl,
        createdAt: createdAt,
        status: status ?? this.status,
      );
}

/// Short preview used in the chat list.
String messageSnippet(String type, String? content) {
  switch (type) {
    case 'image':
      return '📷 Photo';
    case 'audio':
      return '🎤 Voice message';
    case 'file':
      return '📎 File';
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
    byId[m.id] = m;
  }
  return byId.values.toList()
    ..sort((a, b) => a.createdAt.compareTo(b.createdAt));
}
