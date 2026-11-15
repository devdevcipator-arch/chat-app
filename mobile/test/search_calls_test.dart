import 'package:chat_app/core/time_format.dart';
import 'package:chat_app/data/call_repository.dart';
import 'package:chat_app/models/chat_message.dart';
import 'package:chat_app/models/chat_summary.dart';
import 'package:chat_app/models/profile.dart';
import 'package:chat_app/services/missed_calls.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

ChatSummary _direct(String username, String? displayName) => ChatSummary(
      chatId: 'd-$username',
      type: 'direct',
      createdAt: DateTime.utc(2026),
      other: Profile(id: username, username: username, displayName: displayName),
      lastMessage: null,
    );

ChatSummary _group(String title) => ChatSummary(
      chatId: 'g-$title',
      type: 'group',
      createdAt: DateTime.utc(2026),
      other: null,
      lastMessage: null,
      title: title,
    );

CallRow _call({String status = 'missed', String callee = 'me', bool group = false, DateTime? at}) => CallRow(
      id: 'c',
      chatId: 'chat',
      callerId: 'them',
      calleeId: callee,
      status: status,
      callType: 'voice',
      isGroup: group,
      createdAt: at ?? DateTime.utc(2026, 11, 15, 12),
    );

void main() {
  group('chat search', () {
    final alice = _direct('alice_w', 'Alice Wong');
    final team = _group('Weekend Team');

    test('direct chats match display name or @username, case-insensitive', () {
      expect(alice.matches('alice'), isTrue);
      expect(alice.matches('WONG'), isTrue);
      expect(alice.matches('@alice_w'), isTrue);
      expect(alice.matches('bob'), isFalse);
    });

    test('groups match their title, case-insensitive', () {
      expect(team.matches('weekend'), isTrue);
      expect(team.matches('END TE'), isTrue);
      expect(team.matches('alice'), isFalse);
    });

    test('an empty query matches everything', () {
      expect(alice.matches(''), isTrue);
      expect(team.matches('  '), isTrue);
    });
  });

  test('call receipts are recognised; other system messages are not', () {
    ChatMessage system(String text) => ChatMessage(
          id: text,
          chatId: 'c',
          senderId: null,
          type: 'system',
          content: text,
          mediaUrl: null,
          createdAt: DateTime.utc(2026),
        );
    expect(system('📞 Voice call · 01:23').isCallReceipt, isTrue);
    expect(system('📹 Missed video call').isCallReceipt, isTrue);
    expect(system('Alice renamed the group').isCallReceipt, isFalse);
  });

  test('date and time are both shown', () {
    const l10n = DefaultMaterialLocalizations();
    final at = DateTime(2026, 11, 15, 16, 15);
    expect(formatDateTimeWith(l10n, at), 'Nov 15, 2026 · 4:15 PM');
    expect(formatDateTimeWith(l10n, at, use24h: true), 'Nov 15, 2026 · 16:15');
  });

  group('missed-calls badge', () {
    final seen = DateTime.utc(2026, 11, 15, 10);

    test('counts unanswered 1-on-1 calls to me after last seen', () {
      for (final status in ['missed', 'declined', 'cancelled']) {
        expect(MissedCalls.counts(_call(status: status), meId: 'me', seenAt: seen), isTrue, reason: status);
      }
    });

    test('ignores answered, outgoing, group and already-seen calls', () {
      expect(MissedCalls.counts(_call(status: 'ended'), meId: 'me', seenAt: seen), isFalse);
      expect(MissedCalls.counts(_call(callee: 'them'), meId: 'me', seenAt: seen), isFalse);
      expect(MissedCalls.counts(_call(group: true), meId: 'me', seenAt: seen), isFalse);
      expect(MissedCalls.counts(_call(at: DateTime.utc(2026, 11, 15, 9)), meId: 'me', seenAt: seen), isFalse);
    });
  });
}
