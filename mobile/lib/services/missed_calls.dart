import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../core/supabase.dart';
import '../data/call_repository.dart';
import '../data/local_cache.dart';
import 'call_controller.dart';
import 'network_status.dart';

/// Unseen missed calls, for the badge on the Calls tab (`value` = count).
///
/// Counts 1-on-1 calls to me that I didn't pick up (missed, declined, or
/// hung up by the caller before I answered: the same calls the Calls list
/// shows in red) made after `last_seen_calls_at`, which is stored on the
/// device and moved to "now" whenever the Calls tab is opened. Live updates
/// come from [CallController]'s existing Realtime channel; the last count is
/// cached so the badge is right on launch and offline.
class MissedCalls extends ValueNotifier<int> {
  MissedCalls._() : super(0);
  static final instance = MissedCalls._();

  static const unseenStatuses = ['missed', 'declined', 'cancelled'];

  String? _meId;
  DateTime _seenAt = DateTime.now().toUtc();
  StreamSubscription<CallRow>? _rowSub;
  StreamSubscription<void>? _reconnectSub;
  Timer? _debounce;

  /// Whether [row] is a call that should raise the badge.
  @visibleForTesting
  static bool counts(CallRow row, {required String meId, required DateTime seenAt}) =>
      !row.isGroup &&
      row.calleeId == meId &&
      unseenStatuses.contains(row.status) &&
      row.createdAt.isAfter(seenAt);

  void attach(String meId) {
    if (_meId == meId) return;
    detach();
    _meId = meId;
    final seen = LocalCache.callsSeenAt(meId);
    if (seen == null) {
      // First run for this account: start counting from now rather than
      // flagging every missed call in the history.
      unawaited(LocalCache.saveCallsSeenAt(meId, _seenAt = DateTime.now().toUtc()));
    } else {
      _seenAt = seen;
    }
    value = LocalCache.missedCalls(meId) ?? 0;
    _rowSub = CallController.instance.rowChanges.listen((row) {
      if (counts(row, meId: meId, seenAt: _seenAt)) _refreshSoon();
    });
    _reconnectSub = NetworkStatus.instance.reconnects.listen((_) => _refreshSoon());
    unawaited(refresh());
  }

  void detach() {
    _rowSub?.cancel();
    _reconnectSub?.cancel();
    _debounce?.cancel();
    _rowSub = null;
    _reconnectSub = null;
    _meId = null;
    value = 0;
  }

  void _refreshSoon() {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), refresh);
  }

  /// Recounts on the server (RLS: only calls I'm part of are visible).
  Future<void> refresh() async {
    final meId = _meId;
    if (meId == null) return;
    final since = _seenAt;
    try {
      final response = await supabase
          .from('calls')
          .select('id')
          .eq('callee_id', meId)
          .eq('is_group', false)
          .inFilter('status', unseenStatuses)
          .gt('created_at', since.toIso8601String())
          .count(CountOption.exact);
      // Stale if I switched accounts or opened the Calls tab meanwhile.
      if (_meId != meId || _seenAt != since) return;
      _set(meId, response.count);
    } catch (e) {
      NetworkStatus.instance.reportFailure(e);
    }
  }

  /// The Calls tab was opened: everything up to now is seen.
  void markSeen() {
    final meId = _meId;
    if (meId == null) return;
    _seenAt = DateTime.now().toUtc();
    unawaited(LocalCache.saveCallsSeenAt(meId, _seenAt));
    _set(meId, 0);
  }

  void _set(String meId, int count) {
    value = count;
    unawaited(LocalCache.saveMissedCalls(meId, count));
  }
}
