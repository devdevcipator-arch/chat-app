import 'profile.dart';

class LastMessage {
  const LastMessage({
    required this.content,
    required this.type,
    required this.senderId,
    required this.createdAt,
  });

  final String? content;
  final String type;
  final String? senderId;
  final DateTime createdAt;
}

/// One row of the `list_my_chats` RPC.
class ChatSummary {
  const ChatSummary({
    required this.chatId,
    required this.type,
    required this.createdAt,
    required this.other,
    required this.lastMessage,
  });

  final String chatId;
  final String type;
  final DateTime createdAt;
  final Profile? other;
  final LastMessage? lastMessage;

  DateTime get lastActivity => lastMessage?.createdAt ?? createdAt;

  // Other-participant and last-message columns come from LEFT JOINs, so any
  // of them may be null.
  factory ChatSummary.fromRow(Map<String, dynamic> row) {
    final otherId = row['other_user_id'] as String?;
    final lastAt = row['last_message_at'] as String?;
    return ChatSummary(
      chatId: row['chat_id'] as String,
      type: row['chat_type'] as String,
      createdAt: DateTime.parse(row['chat_created_at'] as String),
      other: otherId == null
          ? null
          : Profile(
              id: otherId,
              username: row['other_username'] as String?,
              displayName: row['other_display_name'] as String?,
              avatarUrl: row['other_avatar_url'] as String?,
            ),
      lastMessage: lastAt == null
          ? null
          : LastMessage(
              content: row['last_message_content'] as String?,
              type: row['last_message_type'] as String,
              senderId: row['last_message_sender_id'] as String?,
              createdAt: DateTime.parse(lastAt),
            ),
    );
  }

  ChatSummary withLastMessage(LastMessage message) => ChatSummary(
        chatId: chatId,
        type: type,
        createdAt: createdAt,
        other: other,
        lastMessage: message,
      );
}
