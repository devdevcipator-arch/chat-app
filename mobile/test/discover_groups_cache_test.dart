import 'package:chat_app/data/local_cache.dart';
import 'package:chat_app/models/chat_summary.dart';
import 'package:chat_app/models/gallery_item.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    LocalCache.resetForTest();
    await LocalCache.init();
    await LocalCache.saveUser('u1');
  });

  test('search_groups rows parse, with safe defaults for missing fields', () {
    final joined = GroupSearchResult.fromRow({
      'id': 'g1',
      'title': 'Book Club',
      'avatar_url': null,
      'member_count': 12,
      'is_member': true,
    });
    expect(joined.title, 'Book Club');
    expect(joined.memberCount, 12);
    expect(joined.isMember, isTrue);

    final bare = GroupSearchResult.fromRow({'id': 'g2'});
    expect(bare.title, 'Group');
    expect(bare.memberCount, 0);
    expect(bare.isMember, isFalse);
  });

  test('cached rows round-trip and are scoped to the signed-in user', () async {
    await LocalCache.saveRows('u1', 'calls', [
      {'id': 'call1', 'status': 'ended'},
    ]);
    expect(LocalCache.rows('u1', 'calls'), [
      {'id': 'call1', 'status': 'ended'},
    ]);
    await LocalCache.saveRows('someone-else', 'calls', [
      {'id': 'x'},
    ]);
    expect(LocalCache.rows('someone-else', 'calls'), isNull);
    await LocalCache.clear();
    expect(LocalCache.rows('u1', 'calls'), isNull);
  });

  test('gallery items survive the cache round-trip', () async {
    final item = GalleryItem(
      id: 'i1',
      key: 'vault/u1/abc.jpg',
      fileName: 'photo.jpg',
      kind: 'image',
      size: 2048,
      createdAt: DateTime.utc(2026, 1, 2, 3, 4),
    );
    await LocalCache.saveRows('u1', 'gallery', [item.toMap()]);
    final back = GalleryItem.fromMap(LocalCache.rows('u1', 'gallery')!.single);
    expect(back.id, item.id);
    expect(back.key, item.key);
    expect(back.fileName, item.fileName);
    expect(back.kind, item.kind);
    expect(back.size, item.size);
    expect(back.createdAt, item.createdAt);
  });
}
