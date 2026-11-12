import 'package:chat_app/core/media.dart';
import 'package:chat_app/models/chat_message.dart';
import 'package:chat_app/models/chat_summary.dart';
import 'package:flutter_test/flutter_test.dart';

ChatMessage _text({required DateTime createdAt, String sender = 'me'}) => ChatMessage(
      id: 'm1',
      chatId: 'c1',
      senderId: sender,
      type: 'text',
      content: 'hi',
      mediaUrl: null,
      createdAt: createdAt,
    );

void main() {
  test('media types resolve by extension, matching the web rules', () {
    expect(mediaTypeFor('voice.m4a')?.mime, 'audio/mp4');
    expect(mediaTypeFor('voice.m4a')?.messageType, 'audio');
    expect(mediaTypeFor('Clip.MOV')?.mime, 'video/quicktime');
    expect(mediaTypeFor('report.pdf')?.messageType, 'file');
    expect(mediaTypeFor('photo.jpeg')?.ext, 'jpg');
    expect(mediaTypeFor('malware.exe'), isNull);
    expect(chatAcceptsImage(mediaTypeFor('a.gif')!), isFalse);
  });

  test('upload limits mirror the server', () {
    expect(chatUploadLimit(mediaTypeFor('a.jpg')!), 2 * 1024 * 1024);
    expect(chatUploadLimit(mediaTypeFor('a.mp4')!), 100 * 1024 * 1024);
    expect(galleryUploadLimit(mediaTypeFor('a.jpg')!), 20 * 1024 * 1024);
  });

  test('only our own object keys become public URLs', () {
    expect(mediaPublicUrl(null), isNull);
    expect(mediaPublicUrl('https://evil.example/x.png'), isNull);
    expect(mediaPublicUrl('chats/../x.png'), isNull);
  });

  test('text messages are editable by their author for 10 minutes', () {
    final now = DateTime.utc(2026, 11, 12, 12);
    expect(_text(createdAt: now.subtract(const Duration(minutes: 9))).canEdit('me', now: now), isTrue);
    expect(_text(createdAt: now.subtract(const Duration(minutes: 11))).canEdit('me', now: now), isFalse);
    expect(_text(createdAt: now).canEdit('someone-else', now: now), isFalse);
  });

  test('snippets match the web chat list', () {
    expect(messageSnippet('voicemail', null, 34), '🎙️ Voicemail · 00:34');
    expect(messageSnippet('audio', null, 7), '🎤 Voice message · 00:07');
    expect(messageSnippet('file', 'q3.pdf'), '📎 q3.pdf');
    expect(messageSnippet('video', 'clip.mp4'), '🎬 Video');
    expect(formatDuration(125), '02:05');
    expect(formatBytes(1536), '1.5 KB');
  });

  test('group rows parse title, role, mute and unread count', () {
    final chat = ChatSummary.fromRow({
      'chat_id': 'c1',
      'chat_type': 'group',
      'chat_created_at': '2026-11-06T10:00:00Z',
      'title': 'Team',
      'member_count': 4,
      'my_role': 'admin',
      'is_muted': true,
      'unread_count': 3,
      'other_user_id': null,
      'last_message_at': '2026-11-06T11:00:00Z',
      'last_message_type': 'audio',
      'last_message_content': null,
      'last_message_sender_id': 'u2',
      'last_message_sender_name': 'Bo',
      'last_message_duration_seconds': 12,
    });
    expect(chat.isGroup, isTrue);
    expect(chat.name, 'Team');
    expect(chat.isAdmin, isTrue);
    expect(chat.isMuted, isTrue);
    expect(chat.unreadCount, 3);
    expect(chat.lastMessage?.durationSeconds, 12);
  });
}
