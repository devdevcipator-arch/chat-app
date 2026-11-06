/// Public profile fields. Never includes email or other private data.
class Profile {
  const Profile({
    required this.id,
    this.username,
    this.displayName,
    this.avatarUrl,
  });

  final String id;
  final String? username;
  final String? displayName;
  final String? avatarUrl;

  bool get hasUsername => username != null && username!.isNotEmpty;

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
      );
}
