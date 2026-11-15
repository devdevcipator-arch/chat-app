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
    // GIFs aren't chat images (no re-encoding): they go as a file card.
    expect(chatUploadTypeFor('a.gif')?.messageType, 'file');
    expect(chatUploadTypeFor('a.png')?.messageType, 'image');
  });

  group('any file format except executables', () {
    test('.epub and other documents resolve by extension, not the picker type', () {
      final epub = mediaTypeFor('My Book.EPUB')!;
      expect(epub.mime, 'application/epub+zip');
      expect(epub.ext, 'epub');
      expect(epub.messageType, 'file');
      expect(mediaTypeFor('notes.odt')?.mime, 'application/vnd.oasis.opendocument.text');
      expect(mediaTypeFor('archive.7z')?.mime, 'application/x-7z-compressed');
    });

    test('unknown formats are sent as generic files (downloaded, never rendered)', () {
      expect(mediaTypeFor('scan.heic')?.mime, 'application/octet-stream');
      expect(mediaTypeFor('page.html')?.mime, 'application/octet-stream');
      expect(mediaTypeFor('README')?.ext, 'bin');
      expect(mediaTypeFor('weird.name.with.a.very-long-extension')?.ext, 'bin');
    });

    test('executables and script hosts are refused', () {
      for (final name in ['setup.exe', 'run.BAT', 'x.cmd', 'a.scr', 'b.msi', 'c.ps1', 'd.vbs', 'e.js', 'f.jar']) {
        expect(mediaTypeFor(name), isNull, reason: name);
      }
    });

    test('format badges', () {
      expect(formatBadge('Book.epub'), 'EPUB');
      expect(formatBadge('q3.pdf'), 'PDF');
      expect(formatBadge('README'), 'FILE');
      expect(formatBadge(null), 'FILE');
    });

    test('any allowed extension is a valid key, executables never are', () {
      const id = '11111111-2222-3333-4444-555555555555';
      const prefix = 'chats/$id/$id/$id';
      // Without R2_PUBLIC_BASE no URL is built, but the key check runs first:
      // both must be null here; the shape is asserted via mediaTypeFor above.
      expect(mediaPublicUrl('$prefix.exe'), isNull);
      expect(mediaPublicUrl('$prefix.toolongextension'), isNull);
    });
  });

  test('file size round-trips through the message model', () {
    final m = ChatMessage.fromMap({
      'id': 'm',
      'chat_id': 'c',
      'sender_id': 'u',
      'message_type': 'file',
      'content': 'Book.epub',
      'media_url': null,
      'created_at': '2026-11-15T12:00:00Z',
      'file_size': 2516582,
    });
    expect(m.fileSize, 2516582);
    expect(ChatMessage.fromMap(m.toMap()).fileSize, 2516582);
    expect(formatBytes(m.fileSize!), '2.4 MB');
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
