import 'dart:io';

import 'package:supabase_flutter/supabase_flutter.dart';

import '../core/api.dart';
import '../core/supabase.dart';
import '../models/profile.dart';

/// Profile reads/writes. Database calls run as the signed-in user under RLS;
/// avatar uploads go through the web API (presigned R2 PUT).
abstract final class ProfileRepository {
  static const _columns = 'id, username, display_name, avatar_url, theme_preference';
  static const displayNameMax = 50;

  /// The signed-in user's own profile (created by the signup trigger).
  static Future<Profile> fetchMine(String userId) async {
    final row = await supabase.from('profiles').select(_columns).eq('id', userId).maybeSingle();
    return row == null ? Profile(id: userId) : Profile.fromMap(row);
  }

  /// Exact @username lookup via the `find_profile_by_username` RPC.
  static Future<Profile?> findByUsername(String username) async {
    final rows = await supabase.rpc(
      'find_profile_by_username',
      params: {'p_username': username},
    ) as List<dynamic>;
    if (rows.isEmpty) return null;
    return Profile.fromMap(rows.first as Map<String, dynamic>);
  }

  /// A contact's public profile (RLS: self and people I share a chat with).
  static Future<Profile?> fetchPublic(String userId) async {
    final row = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url')
        .eq('id', userId)
        .maybeSingle();
    return row == null ? null : Profile.fromMap(row);
  }

  /// Sets username + display name. Throws [PostgrestException] on failure
  /// (23505 = username taken, 23514 = invalid format).
  static Future<Profile> completeOnboarding({
    required String userId,
    required String username,
    required String displayName,
  }) async {
    final row = await supabase
        .from('profiles')
        .update({
          'username': username,
          'display_name': displayName.trim().isEmpty ? username : displayName.trim(),
        })
        .eq('id', userId)
        .select(_columns)
        .maybeSingle();
    if (row == null) {
      // RLS matched no row: the session no longer belongs to this profile.
      throw const PostgrestException(message: 'Profile not found', code: '42501');
    }
    return Profile.fromMap(row);
  }

  /// Trims and collapses whitespace; an empty name clears it.
  static String normalizeDisplayName(String value) => value.replaceAll(RegExp(r'\s+'), ' ').trim();

  static Future<Profile> updateDisplayName(String userId, String displayName) async {
    final name = normalizeDisplayName(displayName);
    final row = await supabase
        .from('profiles')
        .update({'display_name': name.isEmpty ? null : name})
        .eq('id', userId)
        .select(_columns)
        .single();
    return Profile.fromMap(row);
  }

  /// Uploads an already-resized JPEG/PNG/WebP and makes it the avatar.
  /// Returns the new object key.
  static Future<String> uploadAvatar(File file) async {
    final size = await file.length();
    final lower = file.path.toLowerCase();
    final type = lower.endsWith('.png')
        ? 'image/png'
        : lower.endsWith('.webp')
            ? 'image/webp'
            : 'image/jpeg';
    if (size > 1024 * 1024) throw const ApiException('That photo is too large.');

    final target = await Api.post('/api/profile/avatar/upload-url', {'fileType': type, 'fileSize': size});
    await Api.uploadFile(
      uploadUrl: target['uploadUrl'] as String,
      headers: stringMap(target['headers']),
      file: file,
      length: size,
    );
    final result = await Api.put('/api/profile/avatar', {
      'fileId': target['fileId'],
      'fileType': target['fileType'] ?? type,
    });
    return result['avatarUrl'] as String;
  }

  static Future<void> removeAvatar() => Api.delete('/api/profile/avatar');
}
