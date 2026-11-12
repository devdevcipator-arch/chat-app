import 'profile.dart';

class LastMessage {
  const LastMessage({
    required this.content,
    required this.type,
    required this.senderId,
    required this.createdAt,
    this.senderName,
    this.durationSeconds,
  });

  final String? content;
  final String type;
  final String? senderId;
  final String? senderName;
  final DateTime createdAt;
  final int? durationSeconds;
}

/// One row of the `list_my_chats` RPC.
class ChatSummary {
  const ChatSummary({
    required this.chatId,
    required this.type,
    required this.createdAt,
    required this.other,
    required this.lastMessage,
    this.title,
    this.avatarUrl,
    this.memberCount = 0,
    this.isAdmin = false,
    this.isMuted = false,
    this.unreadCount = 0,
  });

  final String chatId;

  /// direct | group
  final String type;
  final DateTime createdAt;
  final Profile? other;
  final LastMessage? lastMessage;
  final String? title;
  final String? avatarUrl;
  final int memberCount;
  final bool isAdmin;
  final bool isMuted;
  final int unreadCount;

  bool get isGroup => type == 'group';
  DateTime get lastActivity => lastMessage?.createdAt ?? createdAt;
  String get name => isGroup ? ((title?.isNotEmpty ?? false) ? title! : 'Group') : profileName(other);

  // Other-participant and last-message columns come from LEFT JOINs, so any
  // of them may be null even where the generated types say otherwise.
  factory ChatSummary.fromRow(Map<String, dynamic> row) {
    final otherId = row['other_user_id'] as String?;
    final lastAt = row['last_message_at'] as String?;
    return ChatSummary(
      chatId: row['chat_id'] as String,
      type: row['chat_type'] == 'group' ? 'group' : 'direct',
      createdAt: DateTime.parse(row['chat_created_at'] as String),
      title: row['title'] as String?,
      avatarUrl: row['avatar_url'] as String?,
      memberCount: (row['member_count'] as num?)?.toInt() ?? 0,
      isAdmin: row['my_role'] == 'admin',
      isMuted: row['is_muted'] == true,
      unreadCount: (row['unread_count'] as num?)?.toInt() ?? 0,
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
              type: row['last_message_type'] as String? ?? 'text',
              senderId: row['last_message_sender_id'] as String?,
              senderName: row['last_message_sender_name'] as String?,
              createdAt: DateTime.parse(lastAt),
              durationSeconds: (row['last_message_duration_seconds'] as num?)?.toInt(),
            ),
    );
  }

  ChatSummary copyWith({LastMessage? lastMessage, int? unreadCount, bool? isMuted}) => ChatSummary(
        chatId: chatId,
        type: type,
        createdAt: createdAt,
        other: other,
        lastMessage: lastMessage ?? this.lastMessage,
        title: title,
        avatarUrl: avatarUrl,
        memberCount: memberCount,
        isAdmin: isAdmin,
        isMuted: isMuted ?? this.isMuted,
        unreadCount: unreadCount ?? this.unreadCount,
      );
}
