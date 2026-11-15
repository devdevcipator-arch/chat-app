import 'package:chat_app/models/chat_summary.dart';
import 'package:chat_app/screens/chat_list_screen.dart';
import 'package:flutter_test/flutter_test.dart';

ChatSummary _group(String title) => ChatSummary(
      chatId: 'g-$title',
      type: 'group',
      createdAt: DateTime.utc(2025), // old, no messages: still findable
      other: null,
      lastMessage: null,
      title: title,
    );

void main() {
  final groups = [_group('Book Club'), _group('Trading'), _group('Family')];
  List<String> find(String q) => [for (final g in groups) if (g.matches(q)) g.title!];

  test('partial, case-insensitive title matches find existing groups instantly', () {
    expect(find('book'), ['Book Club']);
    expect(find('trad'), ['Trading']);
    expect(find('CLUB'), ['Book Club']);
    expect(find('@fam'), ['Family']); // a leading @ never hides groups
    expect(find('zzz'), isEmpty);
  });

  test('only username-shaped queries trigger the Find People lookup', () {
    expect(usernameQuery('@Alice_1'), 'alice_1');
    expect(usernameQuery('trad'), 'trad');
    expect(usernameQuery('Book Club'), isNull); // spaces: a group title, not a username
    expect(usernameQuery('ab'), isNull); // too short to be a username
  });
}
