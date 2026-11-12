import 'package:supabase_flutter/supabase_flutter.dart';

import '../core/api.dart';
import '../core/supabase.dart';

/// A row of `calls`.
class CallRow {
  const CallRow({
    required this.id,
    required this.chatId,
    required this.callerId,
    required this.calleeId,
    required this.status,
    required this.callType,
    required this.isGroup,
    required this.createdAt,
  });

  final String id;
  final String chatId;
  final String callerId;
  final String? calleeId;

  /// ringing | accepted | declined | cancelled | missed | ended | active
  final String status;

  /// voice | video
  final String callType;
  final bool isGroup;
  final DateTime createdAt;

  bool get isVideo => callType == 'video';
  bool get isClosed => const {'declined', 'cancelled', 'missed', 'ended'}.contains(status);

  factory CallRow.fromMap(Map<String, dynamic> m) => CallRow(
        id: m['id'] as String,
        chatId: m['chat_id'] as String,
        callerId: m['caller_id'] as String,
        calleeId: m['callee_id'] as String?,
        status: m['status'] as String,
        callType: m['call_type'] == 'video' ? 'video' : 'voice',
        isGroup: m['is_group'] == true,
        createdAt: DateTime.parse(m['created_at'] as String),
      );
}

class ActiveGroupCall {
  const ActiveGroupCall({required this.callId, required this.callType, required this.participantIds});
  final String callId;
  final String callType;
  final List<String> participantIds;
}

class AgoraToken {
  const AgoraToken({required this.appId, required this.token, required this.channelName, required this.uid});
  final String appId;
  final String token;
  final String channelName;
  final String uid;
}

/// Why start_call refused.
class StartCallException implements Exception {
  const StartCallException(this.reason);

  /// callee-busy | caller-busy | call-full | unavailable | error
  final String reason;
}

/// Call signaling over Supabase (see web/src/lib/call/signaling.ts): RPCs
/// change state server-side, postgres_changes on `calls` deliver it.
abstract final class CallRepository {
  static String channelName(String chatId) => 'call_$chatId';

  /// 1-on-1: rings the other person. Group: joins (or opens) the room.
  static Future<CallRow> start(String chatId, String callType) async {
    try {
      final row = await supabase.rpc('start_call', params: {'p_chat_id': chatId, 'p_call_type': callType});
      return CallRow.fromMap(row as Map<String, dynamic>);
    } on PostgrestException catch (e) {
      throw StartCallException(switch (e.message) {
        'callee busy' => 'callee-busy',
        'caller busy' => 'caller-busy',
        'call full' => 'call-full',
        _ => e.code == 'P0002' ? 'unavailable' : 'error',
      });
    } catch (_) {
      throw const StartCallException('error');
    }
  }

  /// The updated call, or null if it is no longer ringing.
  static Future<CallRow?> answer(String callId, {required bool accept}) async {
    try {
      final row = await supabase.rpc('answer_call', params: {'p_call_id': callId, 'p_accept': accept});
      return CallRow.fromMap(row as Map<String, dynamic>);
    } catch (_) {
      return null;
    }
  }

  /// Hang up / cancel (1-on-1) or leave the room (group).
  static Future<void> end(String callId, {bool timeout = false}) async {
    try {
      await supabase.rpc('end_call', params: {'p_call_id': callId, 'p_timeout': timeout});
    } catch (_) {}
  }

  /// false = closed on the server; null = network hiccup.
  static Future<bool?> heartbeat(String callId) async {
    try {
      return await supabase.rpc('heartbeat_call', params: {'p_call_id': callId}) as bool?;
    } catch (_) {
      return null;
    }
  }

  static Future<ActiveGroupCall?> groupCall(String chatId) async {
    try {
      final rows = await supabase.rpc('get_group_call', params: {'p_chat_id': chatId}) as List<dynamic>;
      if (rows.isEmpty) return null;
      final row = rows.first as Map<String, dynamic>;
      return ActiveGroupCall(
        callId: row['call_id'] as String,
        callType: row['call_type'] == 'video' ? 'video' : 'voice',
        participantIds: [for (final id in (row['participant_ids'] as List<dynamic>? ?? const [])) id as String],
      );
    } catch (_) {
      return null;
    }
  }

  /// Calls still ringing for me (started before the app was open).
  static Future<CallRow?> ringingForMe(String meId) async {
    try {
      final since = DateTime.now().toUtc().subtract(const Duration(seconds: 40)).toIso8601String();
      final rows = await supabase
          .from('calls')
          .select()
          .eq('callee_id', meId)
          .eq('status', 'ringing')
          .gte('created_at', since)
          .order('created_at', ascending: false)
          .limit(1);
      return rows.isEmpty ? null : CallRow.fromMap(rows.first);
    } catch (_) {
      return null;
    }
  }

  static Future<AgoraToken> token(String chatId) async {
    final data = await Api.post('/api/agora/token', {'channelName': channelName(chatId)});
    return AgoraToken(
      appId: data['appId'] as String,
      token: data['token'] as String,
      channelName: data['channelName'] as String,
      uid: data['uid'] as String,
    );
  }

  /// Every call I'm a party to. Returns the channel (remove it to stop).
  static RealtimeChannel subscribe(String meId, void Function(String event, CallRow call) onChange) {
    void handle(PostgresChangePayload payload) {
      if (payload.eventType != PostgresChangeEvent.insert && payload.eventType != PostgresChangeEvent.update) return;
      onChange(payload.eventType == PostgresChangeEvent.insert ? 'INSERT' : 'UPDATE', CallRow.fromMap(payload.newRecord));
    }

    return supabase
        .channel('calls:$meId')
        .onPostgresChanges(
          event: PostgresChangeEvent.all,
          schema: 'public',
          table: 'calls',
          filter: PostgresChangeFilter(type: PostgresChangeFilterType.eq, column: 'callee_id', value: meId),
          callback: handle,
        )
        .onPostgresChanges(
          event: PostgresChangeEvent.all,
          schema: 'public',
          table: 'calls',
          filter: PostgresChangeFilter(type: PostgresChangeFilterType.eq, column: 'caller_id', value: meId),
          callback: handle,
        )
        .subscribe();
  }

  /// Fires whenever a call in this chat changes (group rooms ping on join/leave).
  static RealtimeChannel subscribeToChat(String chatId, void Function() onChange) => supabase
      .channel('chat-calls:$chatId')
      .onPostgresChanges(
        event: PostgresChangeEvent.all,
        schema: 'public',
        table: 'calls',
        filter: PostgresChangeFilter(type: PostgresChangeFilterType.eq, column: 'chat_id', value: chatId),
        callback: (_) => onChange(),
      )
      .subscribe((status, _) {
        if (status == RealtimeSubscribeStatus.subscribed) onChange();
      });
}
