import 'profile.dart';

class ChatMember {
  const ChatMember({required this.profile, required this.isAdmin, required this.joinedAt});
  final Profile profile;
  final bool isAdmin;
  final DateTime joinedAt;

  String get id => profile.id;
}

/// What the chat screen needs to render one conversation.
class ChatDetails {
  const ChatDetails({
    required this.id,
    required this.type,
    required this.title,
    required this.members,
    required this.isAdmin,
    required this.isMuted,
  });

  final String id;
  final String type;
  final String? title;

  /// Admins first, then by name.
  final List<ChatMember> members;
  final bool isAdmin;
  final bool isMuted;

  bool get isGroup => type == 'group';

  Profile? other(String meId) {
    for (final m in members) {
      if (m.id != meId) return m.profile;
    }
    return null;
  }

  String name(String meId) =>
      isGroup ? ((title?.isNotEmpty ?? false) ? title! : 'Group') : profileName(other(meId));

  Profile? member(String? id) {
    for (final m in members) {
      if (m.id == id) return m.profile;
    }
    return null;
  }

  ChatDetails copyWith({bool? isMuted}) => ChatDetails(
        id: id,
        type: type,
        title: title,
        members: members,
        isAdmin: isAdmin,
        isMuted: isMuted ?? this.isMuted,
      );
}
