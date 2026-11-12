import 'dart:io';

import 'package:supabase_flutter/supabase_flutter.dart';

import '../core/api.dart';
import '../core/config.dart';
import '../core/media.dart';
import '../core/supabase.dart';
import '../models/chat_details.dart';
import '../models/chat_message.dart';
import '../models/chat_summary.dart';
import '../models/profile.dart';

/// User-facing message for a failed chat/group RPC (mirrors web chat-actions.ts).
String chatActionError(Object error) {
  if (error is PostgrestException) {
    switch (error.message) {
      case 'not a group admin':
        return 'Only group admins can do that.';
      case 'last admin':
        return 'A group needs at least one admin. Make someone else an admin first.';
      case 'too many members':
        return 'Groups can have up to 100 members.';
      case 'invalid title':
        return 'Group names must be 1–60 characters.';
      case 'no members':
        return 'Add at least one other person.';
      case 'not a member':
        return "You're no longer in this conversation.";
    }
    if (error.code == '42501') return 'Your session has expired. Please sign in again.';
    if (error.code == 'P0002') return 'That account is no longer available.';
  }
  if (error is ApiException) return error.message;
  return 'Something went wrong. Please try again.';
}

/// Chat reads/writes. All calls run as the signed-in user, so RLS guarantees
/// only the caller's own chats and messages are visible.
abstract final class ChatRepository {
  static Future<List<ChatSummary>> listMyChats() async {
    final rows = await supabase.rpc('list_my_chats') as List<dynamic>;
    return rows.map((row) => ChatSummary.fromRow(row as Map<String, dynamic>)).toList();
  }

  /// Returns the existing direct chat with [otherUserId] (un-hiding it), or creates one.
  static Future<String> createDirectChat(String otherUserId) async {
    final chatId = await supabase.rpc('create_direct_chat', params: {'p_other_user': otherUserId});
    return chatId as String;
  }

  static Future<String> createGroup(String title, List<String> memberIds) async {
    final chatId = await supabase.rpc(
      'create_group_chat',
      params: {'p_title': title, 'p_member_ids': memberIds},
    );
    return chatId as String;
  }

  /// Title, members and my role/mute; null if I'm no longer in the chat.
  static Future<ChatDetails?> details(String chatId) async {
    final results = await Future.wait<dynamic>([
      supabase.from('chats').select('id, type, title').eq('id', chatId).maybeSingle(),
      supabase
          .from('chat_participants')
          .select('user_id, role, joined_at, profiles(id, username, display_name, avatar_url)')
          .eq('chat_id', chatId),
      supabase.rpc('get_chat_membership', params: {'p_chat_id': chatId}),
    ]);
    final chat = results[0] as Map<String, dynamic>?;
    final participants = results[1] as List<dynamic>;
    final membership = results[2] as List<dynamic>;
    if (chat == null || membership.isEmpty) return null;
    final mine = membership.first as Map<String, dynamic>;

    final members = participants.map((raw) {
      final row = raw as Map<String, dynamic>;
      final p = row['profiles'];
      return ChatMember(
        profile: p is Map<String, dynamic> ? Profile.fromMap(p) : Profile(id: row['user_id'] as String),
        isAdmin: row['role'] == 'admin',
        joinedAt: DateTime.parse(row['joined_at'] as String),
      );
    }).toList()
      ..sort((a, b) => a.isAdmin != b.isAdmin
          ? (a.isAdmin ? -1 : 1)
          : a.profile.name.toLowerCase().compareTo(b.profile.name.toLowerCase()));

    return ChatDetails(
      id: chat['id'] as String,
      type: chat['type'] == 'group' ? 'group' : 'direct',
      title: chat['title'] as String?,
      members: members,
      isAdmin: mine['role'] == 'admin',
      isMuted: mine['is_muted'] == true,
    );
  }

  /// The most recent messages, oldest first (RLS hides anything before "clear chat").
  static Future<List<ChatMessage>> recentMessages(String chatId) async {
    final rows = await supabase
        .from('messages')
        .select()
        .eq('chat_id', chatId)
        .order('created_at', ascending: false)
        .limit(AppConfig.messagePageSize);
    return rows.reversed.map(ChatMessage.fromMap).toList();
  }

  /// Inserts a text message with a client-chosen [id]; `created_at` is set by the server.
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

  /// Uploads [file] through /api/media/upload-url (presigned R2 PUT) and posts it.
  ///
  /// [messageType] is normally [MediaType.messageType]; pass 'voicemail' (with
  /// [callId]) for a voicemail.
  static Future<ChatMessage> sendMedia({
    required String id,
    required String chatId,
    required String senderId,
    required File file,
    required String fileName,
    required MediaType type,
    String? messageType,
    int? durationSeconds,
    String? callId,
    void Function(double fraction)? onProgress,
  }) async {
    final size = await file.length();
    if (size == 0) throw const ApiException('That file is empty.');
    final limit = chatUploadLimit(type);
    if (size > limit) {
      throw ApiException('Files like this must be ${limit ~/ (1024 * 1024)} MB or smaller.');
    }

    final target = await Api.post('/api/media/upload-url', {
      'chatId': chatId,
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

    final kind = messageType ?? type.messageType;
    final row = <String, Object?>{
      'id': id,
      'chat_id': chatId,
      'sender_id': senderId,
      'message_type': kind,
      // Videos and files show their original name in the bubble.
      'content': kind == 'video' || kind == 'file' ? fileName : null,
      'media_url': target['key'] as String,
      'duration_seconds': ?durationSeconds,
    };

    try {
      final saved = await supabase
          .from('messages')
          .insert({...row, 'call_id': ?callId})
          .select()
          .single();
      return ChatMessage.fromMap(saved);
    } on PostgrestException {
      // Linking a voicemail to its call is a nicety: still deliver it unlinked.
      if (callId == null) rethrow;
      final saved = await supabase.from('messages').insert(row).select().single();
      return ChatMessage.fromMap(saved);
    }
  }

  /// Saves an edit (text only, own message, within 10 minutes; enforced in SQL).
  static Future<ChatMessage> editMessage(String messageId, String content) async {
    try {
      final row = await supabase.rpc(
        'edit_message',
        params: {'p_message_id': messageId, 'p_new_content': content},
      );
      return ChatMessage.fromMap(row as Map<String, dynamic>);
    } on PostgrestException catch (e) {
      if (e.hint == 'edit_window_expired' || RegExp('within 10 minutes', caseSensitive: false).hasMatch(e.message)) {
        throw const ApiException('Editing time limit expired (10 minutes max)');
      }
      if (const {'22023', '22001', '42501'}.contains(e.code)) throw ApiException('${e.message}.');
      throw const ApiException("Couldn't edit the message. Please try again.");
    }
  }

  static Future<void> markRead(String chatId) async {
    try {
      await supabase.rpc('mark_chat_read', params: {'p_chat_id': chatId});
    } catch (_) {
      // Unread badges are cosmetic; never fail the screen over them.
    }
  }

  static Future<DateTime?> markVoicemailPlayed(String messageId) async {
    try {
      final at = await supabase.rpc('mark_voicemail_played', params: {'p_message_id': messageId});
      return at is String ? DateTime.parse(at) : null;
    } catch (_) {
      return null;
    }
  }

  static Future<void> setMuted(String chatId, bool muted) =>
      supabase.rpc('set_chat_muted', params: {'p_chat_id': chatId, 'p_muted': muted});

  static Future<void> clearChat(String chatId) => supabase.rpc('clear_chat', params: {'p_chat_id': chatId});

  /// "Delete conversation" for a direct chat (only for me).
  static Future<void> hideChat(String chatId) => supabase.rpc('hide_chat', params: {'p_chat_id': chatId});

  static Future<void> leaveGroup(String chatId) => supabase.rpc('leave_group', params: {'p_chat_id': chatId});

  static Future<void> deleteGroup(String chatId) => supabase.rpc('delete_group', params: {'p_chat_id': chatId});

  static Future<void> renameGroup(String chatId, String title) =>
      supabase.rpc('update_group', params: {'p_chat_id': chatId, 'p_title': title});

  static Future<void> addMembers(String chatId, List<String> userIds) =>
      supabase.rpc('add_group_members', params: {'p_chat_id': chatId, 'p_member_ids': userIds});

  static Future<void> removeMember(String chatId, String userId) =>
      supabase.rpc('remove_group_member', params: {'p_chat_id': chatId, 'p_user_id': userId});

  static Future<void> setRole(String chatId, String userId, {required bool admin}) => supabase.rpc(
        'set_group_role',
        params: {'p_chat_id': chatId, 'p_user_id': userId, 'p_role': admin ? 'admin' : 'member'},
      );
}
