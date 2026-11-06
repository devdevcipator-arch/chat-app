import 'package:supabase_flutter/supabase_flutter.dart';

import '../core/supabase.dart';
import '../models/profile.dart';

/// Profile reads/writes. All calls run as the signed-in user under RLS.
abstract final class ProfileRepository {
  static const _columns = 'id, username, display_name, avatar_url';

  /// The signed-in user's own profile (created by the signup trigger).
  static Future<Profile> fetchMine(String userId) async {
    final row = await supabase
        .from('profiles')
        .select(_columns)
        .eq('id', userId)
        .maybeSingle();
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
}
