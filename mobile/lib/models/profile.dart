import '../core/media.dart';
import '../core/theme.dart';

/// Public profile fields. Never includes email or other private data.
class Profile {
  const Profile({
    required this.id,
    this.username,
    this.displayName,
    this.avatarUrl,
    this.theme = ThemePreference.dark,
  });

  final String id;
  final String? username;
  final String? displayName;

  /// R2 object key (`avatars/<id>/<uuid>.<ext>`), not a URL.
  final String? avatarUrl;

  /// Only meaningful on the signed-in user's own profile.
  final ThemePreference theme;

  bool get hasUsername => username != null && username!.isNotEmpty;

  String? get avatarImageUrl => mediaPublicUrl(avatarUrl);

  /// Display name, falling back to @username.
  String get name {
    if (displayName != null && displayName!.trim().isNotEmpty) {
      return displayName!;
    }
    return hasUsername ? '@$username' : 'New user';
  }

  factory Profile.fromMap(Map<String, dynamic> map) => Profile(
        id: map['id'] as String,
        username: map['username'] as String?,
        displayName: map['display_name'] as String?,
        avatarUrl: map['avatar_url'] as String?,
        theme: ThemePreference.parse(map['theme_preference']),
      );

  Profile copyWith({String? displayName, String? avatarUrl, bool clearAvatar = false, ThemePreference? theme}) =>
      Profile(
        id: id,
        username: username,
        displayName: displayName ?? this.displayName,
        avatarUrl: clearAvatar ? null : (avatarUrl ?? this.avatarUrl),
        theme: theme ?? this.theme,
      );
}

/// Name for a possibly deleted account.
String profileName(Profile? profile) => profile?.name ?? 'Deleted user';
