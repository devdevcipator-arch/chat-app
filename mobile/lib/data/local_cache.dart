import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/chat_message.dart';
import '../models/chat_summary.dart';
import '../models/profile.dart';

/// The last signed-in account, kept so the app can open straight to Chats
/// (offline too) without waiting on the network.
class CachedUser {
  const CachedUser({required this.id, this.email});
  final String id;
  final String? email;
}

/// Small on-device cache (SharedPreferences + JSON) for the signed-in user's
/// profile, chat list and recent messages per chat.
///
/// Everything is keyed by user id and wiped on sign-out. Reads are
/// synchronous once [init] has run, so screens can render cached data on
/// their very first frame. All failures are swallowed: the cache is an
/// optimisation, never a source of errors.
abstract final class LocalCache {
  static const _prefix = 'cache.v1';
  static const _lastUserKey = '$_prefix.lastUser';

  /// Chats whose messages are kept (most recently opened first).
  static const maxCachedChats = 40;

  /// Messages kept per chat.
  static const maxMessagesPerChat = 100;

  static SharedPreferences? _prefs;

  static Future<void> init() async {
    if (_prefs != null) return;
    try {
      _prefs = await SharedPreferences.getInstance();
    } catch (e) {
      debugPrint('LocalCache unavailable: $e');
    }
  }

  @visibleForTesting
  static void resetForTest() => _prefs = null;

  static String _key(String userId, String name) => '$_prefix.$userId.$name';

  static Object? _readJson(String key) {
    final raw = _prefs?.getString(key);
    if (raw == null) return null;
    try {
      return jsonDecode(raw);
    } catch (_) {
      return null;
    }
  }

  static Future<void> _writeJson(String key, Object value) async {
    try {
      await _prefs?.setString(key, jsonEncode(value));
    } catch (e) {
      debugPrint('LocalCache write failed: $e');
    }
  }

  // --- Signed-in user ---------------------------------------------------------

  static CachedUser? get lastUser {
    final json = _readJson(_lastUserKey);
    if (json is! Map<String, dynamic> || json['id'] is! String) return null;
    return CachedUser(id: json['id'] as String, email: json['email'] as String?);
  }

  static Future<void> saveUser(String userId, {String? email}) =>
      _writeJson(_lastUserKey, {'id': userId, 'email': ?email});

  static Profile? profile(String userId) {
    final json = _readJson(_key(userId, 'profile'));
    if (json is! Map<String, dynamic>) return null;
    try {
      final profile = Profile.fromMap(json);
      return profile.id == userId ? profile : null;
    } catch (_) {
      return null;
    }
  }

  static Future<void> saveProfile(Profile profile) => _writeJson(_key(profile.id, 'profile'), profile.toMap());

  // --- Chat list ---------------------------------------------------------------

  static List<ChatSummary>? chats(String userId) {
    final json = _readJson(_key(userId, 'chats'));
    if (json is! List) return null;
    try {
      return [for (final row in json) ChatSummary.fromRow(row as Map<String, dynamic>)];
    } catch (_) {
      return null;
    }
  }

  static Future<void> saveChats(String userId, List<ChatSummary> chats) =>
      _writeJson(_key(userId, 'chats'), [for (final c in chats) c.toRow()]);

  // --- Messages ----------------------------------------------------------------

  static List<ChatMessage>? messages(String userId, String chatId) {
    final json = _readJson(_key(userId, 'messages.$chatId'));
    if (json is! List) return null;
    try {
      return [for (final row in json) ChatMessage.fromMap(row as Map<String, dynamic>)];
    } catch (_) {
      return null;
    }
  }

  /// Keeps the newest [maxMessagesPerChat] delivered messages of [chatId];
  /// chats beyond [maxCachedChats] (least recently saved) are evicted.
  static Future<void> saveMessages(String userId, String chatId, List<ChatMessage> messages) async {
    final sent = messages.where((m) => m.status == MessageStatus.sent).toList();
    final recent = sent.length > maxMessagesPerChat ? sent.sublist(sent.length - maxMessagesPerChat) : sent;
    await _writeJson(_key(userId, 'messages.$chatId'), [for (final m in recent) m.toMap()]);

    final indexKey = _key(userId, 'messageChats');
    final index = (_readJson(indexKey) as List?)?.whereType<String>().toList() ?? <String>[];
    index
      ..remove(chatId)
      ..insert(0, chatId);
    while (index.length > maxCachedChats) {
      final evicted = index.removeLast();
      try {
        await _prefs?.remove(_key(userId, 'messages.$evicted'));
      } catch (_) {}
    }
    await _writeJson(indexKey, index);
  }

  static Future<void> removeMessages(String userId, String chatId) async {
    try {
      await _prefs?.remove(_key(userId, 'messages.$chatId'));
    } catch (_) {}
  }

  // --- Sign-out ----------------------------------------------------------------

  /// Removes every cached entry (all users) and the last-user record.
  static Future<void> clear() async {
    final prefs = _prefs;
    if (prefs == null) return;
    try {
      for (final key in prefs.getKeys().where((k) => k.startsWith('$_prefix.')).toList()) {
        await prefs.remove(key);
      }
    } catch (_) {}
  }
}
