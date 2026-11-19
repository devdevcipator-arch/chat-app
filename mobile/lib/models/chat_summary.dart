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

/// One row of the `search_groups` RPC: any group on the platform.
class GroupSearchResult {
  const GroupSearchResult({
    required this.id,
    required this.title,
    this.avatarUrl,
    this.memberCount = 0,
    this.isMember = false,
  });

  final String id;
  final String title;
  final String? avatarUrl;
  final int memberCount;
  final bool isMember;

  factory GroupSearchResult.fromRow(Map<String, dynamic> row) => GroupSearchResult(
        id: row['id'] as String,
        title: (row['title'] as String?) ?? 'Group',
        avatarUrl: row['avatar_url'] as String?,
        memberCount: (row['member_count'] as num?)?.toInt() ?? 0,
        isMember: row['is_member'] == true,
      );
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

  /// Search: groups match on their title; direct chats on the other
  /// person's display name or @username. Case-insensitive; a leading "@"
  /// is ignored. An empty query matches everything.
  bool matches(String query) {
    final q = query.trim().toLowerCase().replaceFirst(RegExp(r'^@'), '');
    if (q.isEmpty) return true;
    if (isGroup) return (title ?? '').toLowerCase().contains(q);
    final o = other;
    return (o?.displayName ?? '').toLowerCase().contains(q) ||
        (o?.username ?? '').toLowerCase().contains(q) ||
        name.toLowerCase().contains(q);
  }
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

  /// Inverse of [ChatSummary.fromRow] (used by the local cache).
  Map<String, dynamic> toRow() => {
        'chat_id': chatId,
        'chat_type': type,
        'chat_created_at': createdAt.toIso8601String(),
        'title': title,
        'avatar_url': avatarUrl,
        'member_count': memberCount,
        'my_role': isAdmin ? 'admin' : 'member',
        'is_muted': isMuted,
        'unread_count': unreadCount,
        'other_user_id': other?.id,
        'other_username': other?.username,
        'other_display_name': other?.displayName,
        'other_avatar_url': other?.avatarUrl,
        'last_message_at': lastMessage?.createdAt.toIso8601String(),
        'last_message_content': lastMessage?.content,
        'last_message_type': lastMessage?.type,
        'last_message_sender_id': lastMessage?.senderId,
        'last_message_sender_name': lastMessage?.senderName,
        'last_message_duration_seconds': lastMessage?.durationSeconds,
      };

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
