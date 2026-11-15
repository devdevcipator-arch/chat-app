import 'package:flutter/material.dart';

bool _sameDay(DateTime a, DateTime b) =>
    a.year == b.year && a.month == b.month && a.day == b.day;

/// "14:05" today, otherwise "12 Mar, 14:05" (locale-aware).
String formatMessageTime(BuildContext context, DateTime time) {
  final l10n = MaterialLocalizations.of(context);
  final local = time.toLocal();
  final clock = l10n.formatTimeOfDay(
    TimeOfDay.fromDateTime(local),
    alwaysUse24HourFormat: MediaQuery.alwaysUse24HourFormatOf(context),
  );
  if (_sameDay(local, DateTime.now())) return clock;
  return '${l10n.formatShortMonthDay(local)}, $clock';
}

/// Compact time for the chat list: "14:05" today, otherwise "12 Mar".
String formatListTime(BuildContext context, DateTime time) {
  final l10n = MaterialLocalizations.of(context);
  final local = time.toLocal();
  if (_sameDay(local, DateTime.now())) {
    return l10n.formatTimeOfDay(
      TimeOfDay.fromDateTime(local),
      alwaysUse24HourFormat: MediaQuery.alwaysUse24HourFormatOf(context),
    );
  }
  return l10n.formatShortMonthDay(local);
}

/// Date and time together, e.g. "Nov 15, 2026 · 4:15 PM" (or "· 16:15" with
/// a 24-hour clock). Used where the exact moment matters: call history and
/// call receipts.
String formatDateTimeWith(MaterialLocalizations l10n, DateTime time, {bool use24h = false}) {
  final local = time.toLocal();
  final clock = l10n.formatTimeOfDay(TimeOfDay.fromDateTime(local), alwaysUse24HourFormat: use24h);
  return '${l10n.formatShortMonthDay(local)}, ${local.year} · $clock';
}

String formatDateTime(BuildContext context, DateTime time) => formatDateTimeWith(
      MaterialLocalizations.of(context),
      time,
      use24h: MediaQuery.alwaysUse24HourFormatOf(context),
    );
