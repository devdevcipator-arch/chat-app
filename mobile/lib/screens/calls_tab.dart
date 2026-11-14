import 'dart:async';

import 'package:flutter/material.dart';

import '../core/media.dart';
import '../core/supabase.dart';
import '../core/time_format.dart';
import '../models/chat_summary.dart';
import '../models/profile.dart';
import '../services/call_controller.dart';
import '../widgets/avatar.dart';

const _callLimit = 50;

enum _Direction { incoming, outgoing, missed, declined, ongoing }

const _directionLabel = {
  _Direction.incoming: 'Incoming',
  _Direction.outgoing: 'Outgoing',
  _Direction.missed: 'Missed',
  _Direction.declined: 'Declined',
  _Direction.ongoing: 'Ongoing',
};

class _CallLog {
  const _CallLog({
    required this.id,
    required this.chatId,
    required this.video,
    required this.isGroup,
    required this.createdAt,
    required this.direction,
    required this.detail,
    required this.durationSeconds,
    required this.peer,
  });

  final String id;
  final String chatId;
  final bool video;
  final bool isGroup;
  final DateTime createdAt;
  final _Direction direction;

  /// "Declined" / "No answer" etc. shown after the direction.
  final String? detail;
  final double? durationSeconds;

  /// The other person (direct calls) or whoever started it (group calls).
  final Profile? peer;

  /// Same classification as web/src/app/chat/calls-panel.tsx.
  factory _CallLog.fromRow(Map<String, dynamic> row, String meId) {
    final outgoing = row['caller_id'] == meId;
    final status = row['status'] as String;
    final isGroup = row['is_group'] == true;
    final live = status == 'ringing' || status == 'accepted' || status == 'active';
    final participants = (row['call_participants'] as List? ?? const []).cast<Map<String, dynamic>>();
    _Direction direction;
    String? detail;

    if (live) {
      direction = _Direction.ongoing;
    } else if (isGroup) {
      final joined = outgoing || participants.any((p) => p['user_id'] == meId);
      direction = outgoing ? _Direction.outgoing : (joined ? _Direction.incoming : _Direction.missed);
    } else if (outgoing) {
      direction = _Direction.outgoing;
      detail = switch (status) {
        'declined' => 'Declined',
        'missed' => 'No answer',
        'cancelled' => 'Cancelled',
        _ => null,
      };
    } else if (status == 'declined') {
      direction = _Direction.declined;
    } else if (status == 'missed' || status == 'cancelled') {
      direction = _Direction.missed;
    } else {
      direction = _Direction.incoming;
    }

    Profile? profile(Object? m) => m is Map<String, dynamic> ? Profile.fromMap(m) : null;
    double? seconds() {
      final from = DateTime.tryParse(row['answered_at'] as String? ?? '');
      final to = DateTime.tryParse(row['ended_at'] as String? ?? '');
      if (from == null || to == null) return null;
      final secs = to.difference(from).inMilliseconds / 1000;
      return secs > 0 ? secs : null;
    }

    return _CallLog(
      id: row['id'] as String,
      chatId: row['chat_id'] as String,
      video: row['call_type'] == 'video',
      isGroup: isGroup,
      createdAt: DateTime.parse(row['created_at'] as String),
      direction: direction,
      detail: detail,
      durationSeconds: live ? null : seconds(),
      peer: profile(isGroup || !outgoing ? row['caller'] : row['callee']),
    );
  }
}

/// Recent voice and video calls, newest first.
class CallsTab extends StatefulWidget {
  const CallsTab({super.key, required this.meId, required this.chats, required this.onOpenChat});

  final String meId;
  final List<ChatSummary> chats;
  final ValueChanged<String> onOpenChat;

  @override
  State<CallsTab> createState() => _CallsTabState();
}

class _CallsTabState extends State<CallsTab> {
  final _calls = CallController.instance;
  List<_CallLog>? _logs;
  bool _failed = false;
  late CallPhase _phase = _calls.phase;

  @override
  void initState() {
    super.initState();
    _calls.addListener(_onCallChange);
    unawaited(_load());
  }

  @override
  void dispose() {
    _calls.removeListener(_onCallChange);
    super.dispose();
  }

  /// Reload whenever a call starts or finishes; also redraws redial buttons.
  void _onCallChange() {
    if (_calls.phase == _phase) return;
    _phase = _calls.phase;
    if (mounted) setState(() {});
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final rows = await supabase
          .from('calls')
          .select('id, chat_id, caller_id, callee_id, call_type, status, is_group, created_at, answered_at, ended_at, '
              'caller:profiles!calls_caller_id_fkey(id, username, display_name, avatar_url), '
              'callee:profiles!calls_callee_id_fkey(id, username, display_name, avatar_url), '
              'call_participants(user_id)')
          .eq('call_participants.user_id', widget.meId)
          .order('created_at', ascending: false)
          .limit(_callLimit);
      if (!mounted) return;
      setState(() {
        _logs = [for (final row in rows) _CallLog.fromRow(row, widget.meId)];
        _failed = false;
      });
    } catch (_) {
      if (mounted) setState(() => _failed = true);
    }
  }

  void _redial(_CallLog log) {
    final peer = log.peer;
    if (_calls.busy) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("You're already in a call.")));
      return;
    }
    if (peer == null) return;
    unawaited(_calls.startDirect(chatId: log.chatId, peer: peer, video: log.video));
  }

  @override
  Widget build(BuildContext context) {
    final logs = _logs;
    final scheme = Theme.of(context).colorScheme;

    if (logs == null && !_failed) return const Center(child: CircularProgressIndicator());

    if (logs == null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text("Couldn't load your calls."),
            const SizedBox(height: 8),
            OutlinedButton(onPressed: _load, child: const Text('Try again')),
          ],
        ),
      );
    }

    final chatsById = {for (final c in widget.chats) c.chatId: c};

    return RefreshIndicator(
      onRefresh: _load,
      child: logs.isEmpty
          ? ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              children: [
                const SizedBox(height: 72),
                Center(
                  child: Container(
                    width: 52,
                    height: 52,
                    decoration: BoxDecoration(
                      color: scheme.primary.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Icon(Icons.call_outlined, color: scheme.primary),
                  ),
                ),
                const SizedBox(height: 12),
                Text('No recent calls', textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleSmall),
                const SizedBox(height: 4),
                Text(
                  'Calls you make or receive will show up here.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13),
                ),
              ],
            )
          : ListView.separated(
              physics: const AlwaysScrollableScrollPhysics(),
              itemCount: logs.length,
              separatorBuilder: (_, _) => const Divider(height: 1, indent: 72),
              itemBuilder: (context, i) {
                final log = logs[i];
                final chat = chatsById[log.chatId];
                final name = log.isGroup ? (chat?.name ?? 'Group') : profileName(log.peer ?? chat?.other);
                final bad = log.direction == _Direction.missed || log.direction == _Direction.declined;
                final duration = log.durationSeconds != null ? formatDuration(log.durationSeconds!) : null;
                final status = [_directionLabel[log.direction], log.detail, duration].whereType<String>().join(' · ');
                final badColor = scheme.error;
                final canRedial = !log.isGroup && log.peer != null && !_calls.busy;

                return ListTile(
                  onTap: () => widget.onOpenChat(log.chatId),
                  leading: Avatar(
                    name: name,
                    imageUrl: log.isGroup ? null : log.peer?.avatarImageUrl,
                    group: log.isGroup,
                    size: 44,
                  ),
                  title: Row(
                    children: [
                      Expanded(
                        child: Text(
                          name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: bad ? TextStyle(color: badColor) : null,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        formatListTime(context, log.createdAt),
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(color: scheme.onSurfaceVariant),
                      ),
                    ],
                  ),
                  subtitle: Row(
                    children: [
                      Icon(log.video ? Icons.videocam_outlined : Icons.call_outlined, size: 14, color: bad ? badColor : null),
                      const SizedBox(width: 2),
                      _DirectionIcon(direction: log.direction, color: bad ? badColor : null),
                      const SizedBox(width: 4),
                      Expanded(
                        child: Text(
                          status,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: bad ? TextStyle(color: badColor) : null,
                        ),
                      ),
                    ],
                  ),
                  trailing: IconButton(
                    tooltip: log.isGroup
                        ? 'Open $name to call'
                        : _calls.busy
                            ? "You're already in a call"
                            : log.peer == null
                                ? "Can't call a deleted account"
                                : '${log.video ? 'Video' : 'Voice'} call $name',
                    onPressed: log.isGroup
                        ? () => widget.onOpenChat(log.chatId)
                        : canRedial
                            ? () => _redial(log)
                            : null,
                    icon: Icon(log.video ? Icons.videocam_outlined : Icons.call_outlined),
                  ),
                );
              },
            ),
    );
  }
}

class _DirectionIcon extends StatelessWidget {
  const _DirectionIcon({required this.direction, this.color});

  final _Direction direction;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    if (direction == _Direction.ongoing) {
      return Container(
        width: 7,
        height: 7,
        margin: const EdgeInsets.symmetric(horizontal: 3),
        decoration: const BoxDecoration(color: Colors.green, shape: BoxShape.circle),
      );
    }
    // Outgoing points up-right; everything received points down-left.
    return Icon(direction == _Direction.outgoing ? Icons.call_made : Icons.call_received, size: 14, color: color);
  }
}
