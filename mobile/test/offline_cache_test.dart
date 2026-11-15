import 'dart:async';
import 'dart:io';

import 'package:chat_app/core/errors.dart';
import 'package:chat_app/core/theme.dart';
import 'package:chat_app/data/local_cache.dart';
import 'package:chat_app/models/chat_message.dart';
import 'package:chat_app/models/chat_summary.dart';
import 'package:chat_app/models/profile.dart';
import 'package:chat_app/services/network_status.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

ChatMessage _message(String id, int minute, {MessageStatus status = MessageStatus.sent}) => ChatMessage(
      id: id,
      chatId: 'c1',
      senderId: 'u1',
      type: 'text',
      content: 'hi $id',
      mediaUrl: null,
      createdAt: DateTime.utc(2026, 1, 1, 12, minute),
      status: status,
    );

void main() {
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    LocalCache.resetForTest();
    await LocalCache.init();
    await LocalCache.saveUser('u1');
  });

  test('after sign-out, late writes (screens flushing on dispose) are dropped', () async {
    await LocalCache.saveChats('u1', const []);
    await LocalCache.clear();
    await LocalCache.saveChats('u1', const []);
    await LocalCache.saveMessages('u1', 'c1', [_message('m', 0)]);
    await LocalCache.saveProfile(const Profile(id: 'u1', username: 'alice'));
    expect(LocalCache.chats('u1'), isNull);
    expect(LocalCache.messages('u1', 'c1'), isNull);
    expect(LocalCache.profile('u1'), isNull);
  });

  test('profile round-trips through the cache', () async {
    const profile = Profile(
      id: 'u1',
      username: 'alice',
      displayName: 'Alice',
      avatarUrl: 'avatars/u1/a.jpg',
      theme: ThemePreference.light,
    );
    await LocalCache.saveProfile(profile);
    final cached = LocalCache.profile('u1')!;
    expect(cached.username, 'alice');
    expect(cached.displayName, 'Alice');
    expect(cached.avatarUrl, 'avatars/u1/a.jpg');
    expect(cached.theme, ThemePreference.light);
    expect(LocalCache.profile('someone-else'), isNull);
  });

  test('chat list round-trips, including last message and unread count', () async {
    final chat = ChatSummary(
      chatId: 'c1',
      type: 'direct',
      createdAt: DateTime.utc(2026, 1, 1),
      other: const Profile(id: 'u2', username: 'bob', displayName: 'Bob'),
      lastMessage: LastMessage(
        content: 'see you',
        type: 'text',
        senderId: 'u2',
        createdAt: DateTime.utc(2026, 1, 2, 9),
      ),
      isMuted: true,
      unreadCount: 3,
    );
    final group = ChatSummary(
      chatId: 'g1',
      type: 'group',
      createdAt: DateTime.utc(2026, 1, 1),
      other: null,
      lastMessage: null,
      title: 'Team',
      memberCount: 5,
      isAdmin: true,
    );
    await LocalCache.saveChats('u1', [chat, group]);

    final cached = LocalCache.chats('u1')!;
    expect(cached, hasLength(2));
    expect(cached[0].name, 'Bob');
    expect(cached[0].lastMessage!.content, 'see you');
    expect(cached[0].lastActivity, DateTime.utc(2026, 1, 2, 9));
    expect(cached[0].unreadCount, 3);
    expect(cached[0].isMuted, isTrue);
    expect(cached[1].name, 'Team');
    expect(cached[1].isGroup, isTrue);
    expect(cached[1].isAdmin, isTrue);
    expect(cached[1].memberCount, 5);
    expect(cached[1].lastMessage, isNull);
  });

  test('messages: only delivered ones are kept, newest N per chat', () async {
    final messages = [
      for (var i = 0; i < LocalCache.maxMessagesPerChat + 5; i++) _message('m$i', i % 60),
      _message('pending', 59, status: MessageStatus.sending),
    ];
    await LocalCache.saveMessages('u1', 'c1', messages);
    final cached = LocalCache.messages('u1', 'c1')!;
    expect(cached, hasLength(LocalCache.maxMessagesPerChat));
    expect(cached.first.id, 'm5');
    expect(cached.any((m) => m.id == 'pending'), isFalse);
  });

  test('least recently saved chats are evicted beyond the limit', () async {
    for (var i = 0; i <= LocalCache.maxCachedChats; i++) {
      await LocalCache.saveMessages('u1', 'chat$i', [_message('m', 0)]);
    }
    expect(LocalCache.messages('u1', 'chat0'), isNull);
    expect(LocalCache.messages('u1', 'chat${LocalCache.maxCachedChats}'), isNotNull);
  });

  test('clear wipes everything for sign-out', () async {
    await LocalCache.saveUser('u1', email: 'a@example.com');
    await LocalCache.saveProfile(const Profile(id: 'u1', username: 'alice'));
    await LocalCache.saveChats('u1', const []);
    expect(LocalCache.lastUser!.email, 'a@example.com');

    await LocalCache.clear();
    expect(LocalCache.lastUser, isNull);
    expect(LocalCache.profile('u1'), isNull);
    expect(LocalCache.chats('u1'), isNull);
  });

  test('corrupt cache entries are ignored, not thrown', () async {
    SharedPreferences.setMockInitialValues({'cache.v1.u1.chats': '{not json'});
    LocalCache.resetForTest();
    await LocalCache.init();
    expect(LocalCache.chats('u1'), isNull);
  });

  group('offline detection', () {
    test('network failures count as offline; server rejections do not', () {
      expect(isOfflineError(const SocketException('Failed host lookup')), isTrue);
      expect(isOfflineError(TimeoutException('slow')), isTrue);
      expect(isOfflineError(AuthRetryableFetchException(message: 'ClientException')), isTrue);
      expect(isOfflineError(const AuthApiException('Invalid Refresh Token', statusCode: '400')), isFalse);
      expect(isOfflineError(const PostgrestException(message: 'denied', code: '42501')), isFalse);
    });

    test('NetworkStatus goes offline on a network failure and back on success', () async {
      final status = NetworkStatus.instance;
      final reconnects = <void>[];
      final sub = status.reconnects.listen(reconnects.add);

      status.reportFailure(const PostgrestException(message: 'denied', code: '42501'));
      expect(status.isOnline, isTrue);

      status.reportFailure(const SocketException('Network is unreachable'));
      expect(status.isOnline, isFalse);

      status.reportSuccess();
      expect(status.isOnline, isTrue);
      await Future<void>.delayed(Duration.zero);
      expect(reconnects, hasLength(1));
      await sub.cancel();
    });
  });
}
