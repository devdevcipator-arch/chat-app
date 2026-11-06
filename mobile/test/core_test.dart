import 'package:chat_app/core/ids.dart';
import 'package:chat_app/core/username.dart';
import 'package:chat_app/models/chat_message.dart';
import 'package:chat_app/models/chat_summary.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('username', () {
    test('normalizes to the database format', () {
      expect(normalizeUsername('@John.Doe_99!'), 'johndoe_99');
      expect(normalizeUsername('a' * 30).length, usernameMaxLength);
    });

    test('validates length and characters', () {
      expect(isValidUsername('ab'), isFalse);
      expect(isValidUsername('abc'), isTrue);
      expect(isValidUsername('Abc'), isFalse);
      expect(isValidUsername('a' * 21), isFalse);
    });
  });

  test('uuidV4 produces valid, unique v4 ids', () {
    final ids = List.generate(500, (_) => uuidV4());
    expect(ids.toSet().length, ids.length);
    for (final id in ids) {
      expect(uuidPattern.hasMatch(id), isTrue);
      expect(id[14], '4');
    }
  });

  test('mergeMessages de-duplicates by id and sorts by time', () {
    ChatMessage msg(String id, int second, {MessageStatus status = MessageStatus.sent}) =>
        ChatMessage(
          id: id,
          chatId: 'c',
          senderId: 'u',
          type: 'text',
          content: id,
          mediaUrl: null,
          createdAt: DateTime.utc(2026, 1, 1, 0, 0, second),
          status: status,
        );

    final merged = mergeMessages(
      [msg('b', 2), msg('a', 1, status: MessageStatus.sending)],
      [msg('a', 1), msg('c', 3)],
    );
    expect(merged.map((m) => m.id), ['a', 'b', 'c']);
    expect(merged.first.status, MessageStatus.sent);
  });

  test('ChatSummary.fromRow handles chats without messages', () {
    final chat = ChatSummary.fromRow({
      'chat_id': 'c1',
      'chat_type': 'direct',
      'chat_created_at': '2026-11-06T10:00:00Z',
      'other_user_id': 'u2',
      'other_username': 'alice',
      'other_display_name': null,
      'other_avatar_url': null,
      'last_message_content': null,
      'last_message_type': null,
      'last_message_sender_id': null,
      'last_message_at': null,
    });
    expect(chat.lastMessage, isNull);
    expect(chat.other?.name, '@alice');
    expect(chat.lastActivity, DateTime.utc(2026, 11, 6, 10));
  });
}
