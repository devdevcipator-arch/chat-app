import '../core/config.dart';
import '../core/supabase.dart';
import '../models/chat_message.dart';
import '../models/chat_summary.dart';
import '../models/profile.dart';

/// Chat reads/writes. All calls run as the signed-in user, so RLS guarantees
/// only the caller's own chats and messages are visible.
abstract final class ChatRepository {
  static Future<List<ChatSummary>> listMyChats() async {
    final rows = await supabase.rpc('list_my_chats') as List<dynamic>;
    return rows
        .map((row) => ChatSummary.fromRow(row as Map<String, dynamic>))
        .toList();
  }

  /// Returns the existing direct chat with [otherUserId], or creates one.
  static Future<String> createDirectChat(String otherUserId) async {
    final chatId = await supabase.rpc(
      'create_direct_chat',
      params: {'p_other_user': otherUserId},
    );
    return chatId as String;
  }

  /// The other participant of a direct chat (null if their account is gone).
  static Future<Profile?> otherParticipant(String chatId, String meId) async {
    final rows = await supabase
        .from('chat_participants')
        .select('user_id, profiles(id, username, display_name, avatar_url)')
        .eq('chat_id', chatId)
        .neq('user_id', meId)
        .limit(1);
    if (rows.isEmpty) return null;
    final profile = rows.first['profiles'];
    return profile is Map<String, dynamic> ? Profile.fromMap(profile) : null;
  }

  /// The most recent messages, oldest first.
  static Future<List<ChatMessage>> recentMessages(String chatId) async {
    final rows = await supabase
        .from('messages')
        .select()
        .eq('chat_id', chatId)
        .order('created_at', ascending: false)
        .limit(AppConfig.messagePageSize);
    return rows.reversed.map(ChatMessage.fromMap).toList();
  }

  /// Inserts a text message with a client-chosen [id]; `created_at` is
  /// always set by the server.
  static Future<ChatMessage> sendText({
    required String id,
    required String chatId,
    required String senderId,
    required String content,
  }) async {
    final row = await supabase
        .from('messages')
        .insert({
          'id': id,
          'chat_id': chatId,
          'sender_id': senderId,
          'message_type': 'text',
          'content': content,
        })
        .select()
        .single();
    return ChatMessage.fromMap(row);
  }
}
