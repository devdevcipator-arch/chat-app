import 'dart:async';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../core/api.dart';
import '../core/config.dart';
import '../core/errors.dart';
import '../core/ids.dart';
import '../core/math_evaluator.dart';
import '../core/media.dart';
import '../core/supabase.dart';
import '../core/time_format.dart';
import '../data/call_repository.dart';
import '../data/chat_repository.dart';
import '../data/gallery_repository.dart';
import '../models/chat_details.dart';
import '../models/chat_message.dart';
import '../models/gallery_item.dart';
import '../models/profile.dart';
import '../services/call_controller.dart';
import '../widgets/audio_player.dart';
import '../widgets/avatar.dart';
import '../widgets/math_result_card.dart';
import '../widgets/media_views.dart';
import '../widgets/voice_recorder.dart';
import 'group_info_screen.dart';

/// Result of the chat screen when the conversation is gone for me.
const chatRemoved = 'removed';

class ChatScreen extends StatefulWidget {
  const ChatScreen({
    super.key,
    required this.chatId,
    required this.me,
    this.initialName,
    this.initialOther,
    this.initialIsGroup = false,
  });

  final String chatId;
  final Profile me;

  /// Shown immediately in the header while details load.
  final String? initialName;
  final Profile? initialOther;
  final bool initialIsGroup;

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

/// What's needed to retry a failed upload.
class _PendingUpload {
  const _PendingUpload(this.file, this.fileName, this.type, this.durationSeconds);
  final File file;
  final String fileName;
  final MediaType type;
  final int? durationSeconds;
}

class _ChatScreenState extends State<ChatScreen> {
  ChatDetails? _details;
  List<ChatMessage> _messages = const [];
  final _pending = <String, _PendingUpload>{};
  bool _loading = true;
  String? _loadError;
  bool _connected = true;
  bool _recording = false;
  ActiveGroupCall? _groupCall;
  RealtimeChannel? _channel;
  RealtimeChannel? _callChannel;
  Timer? _clock;

  String get _meId => widget.me.id;
  bool get _isGroup => _details?.isGroup ?? widget.initialIsGroup;

  @override
  void initState() {
    super.initState();
    _load();
    _subscribe();
    if (widget.initialIsGroup) _watchGroupCall();
    // Re-evaluate edit windows ("Edit" disappears after 10 minutes).
    _clock = Timer.periodic(const Duration(seconds: 30), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _clock?.cancel();
    for (final c in [_channel, _callChannel]) {
      if (c != null) unawaited(supabase.removeChannel(c));
    }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait<dynamic>([
        ChatRepository.details(widget.chatId),
        ChatRepository.recentMessages(widget.chatId),
      ]);
      if (!mounted) return;
      final details = results[0] as ChatDetails?;
      if (details == null) {
        _showSnack("You're no longer in this conversation.");
        Navigator.of(context).pop(chatRemoved);
        return;
      }
      setState(() {
        _details = details;
        _messages = mergeMessages(_messages, results[1] as List<ChatMessage>);
        _loading = false;
        _loadError = null;
      });
      if (details.isGroup && _callChannel == null) _watchGroupCall();
      unawaited(ChatRepository.markRead(widget.chatId));
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _loadError = dbErrorMessage(e);
      });
    }
  }

  // Realtime: new messages, and updates (edits, voicemail played).
  void _subscribe() {
    final filter = PostgresChangeFilter(type: PostgresChangeFilterType.eq, column: 'chat_id', value: widget.chatId);
    _channel = supabase
        .channel('chat:${widget.chatId}')
        .onPostgresChanges(
          event: PostgresChangeEvent.insert,
          schema: 'public',
          table: 'messages',
          filter: filter,
          callback: (payload) {
            if (!mounted) return;
            final message = ChatMessage.fromMap(payload.newRecord);
            setState(() => _messages = mergeMessages(_messages, [message]));
            if (message.senderId != _meId) unawaited(ChatRepository.markRead(widget.chatId));
            if (message.type == 'system' && _isGroup) unawaited(_refreshDetails());
          },
        )
        .onPostgresChanges(
          event: PostgresChangeEvent.update,
          schema: 'public',
          table: 'messages',
          filter: filter,
          callback: (payload) {
            if (!mounted) return;
            final message = ChatMessage.fromMap(payload.newRecord);
            if (!_messages.any((m) => m.id == message.id)) return;
            setState(() => _messages = mergeMessages(_messages, [message]));
          },
        )
        .subscribe((status, error) {
          if (!mounted) return;
          if (status == RealtimeSubscribeStatus.subscribed) {
            setState(() => _connected = true);
            unawaited(_catchUp());
          } else if (status == RealtimeSubscribeStatus.channelError || status == RealtimeSubscribeStatus.timedOut) {
            setState(() => _connected = false);
          }
        });
  }

  void _watchGroupCall() {
    _callChannel ??= CallRepository.subscribeToChat(widget.chatId, () async {
      final call = await CallRepository.groupCall(widget.chatId);
      if (mounted) setState(() => _groupCall = call);
    });
  }

  Future<void> _refreshDetails() async {
    try {
      final details = await ChatRepository.details(widget.chatId);
      if (!mounted) return;
      if (details == null) {
        Navigator.of(context).pop(chatRemoved);
        return;
      }
      setState(() => _details = details);
    } catch (_) {}
  }

  /// Covers anything sent between the initial load and (re)subscribing.
  Future<void> _catchUp() async {
    try {
      final recent = await ChatRepository.recentMessages(widget.chatId);
      if (mounted) setState(() => _messages = mergeMessages(_messages, recent));
    } catch (_) {
      // Non-fatal: the live stream and retry still work.
    }
  }

  void _showSnack(String text) {
    ScaffoldMessenger.maybeOf(context)
      ?..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(text)));
  }

  // --- Sending ---------------------------------------------------------------

  ChatMessage _optimisticText(String content, [DateTime? at]) => ChatMessage(
        id: uuidV4(),
        chatId: widget.chatId,
        senderId: _meId,
        type: 'text',
        content: content,
        mediaUrl: null,
        createdAt: (at ?? DateTime.now()).toUtc(),
        status: MessageStatus.sending,
      );

  void _sendText(String content) {
    final optimistic = _optimisticText(content);
    setState(() => _messages = mergeMessages(_messages, [optimistic]));
    unawaited(_deliverText(optimistic));
  }

  /// `/math`: the command as typed, then the answer as an ordinary text message.
  void _sendMath(String expression, String formatted) {
    final now = DateTime.now();
    final question = _optimisticText('/math $expression', now);
    final answer = _optimisticText(mathResultMessage(expression, formatted), now.add(const Duration(milliseconds: 1)));
    setState(() => _messages = mergeMessages(_messages, [question, answer]));
    // One after the other: the server stamps created_at, so inserting both at
    // once could put the answer above the question.
    unawaited(() async {
      if (await _deliverText(question)) {
        await _deliverText(answer);
      } else if (mounted) {
        setState(() => _messages = mergeMessages(_messages, [answer.copyWith(status: MessageStatus.failed)]));
      }
    }());
  }

  /// Whether it went through; failures are marked on the bubble for Retry.
  Future<bool> _deliverText(ChatMessage message) async {
    ChatMessage result;
    var ok = true;
    try {
      result = await ChatRepository.sendText(
        id: message.id,
        chatId: widget.chatId,
        senderId: _meId,
        content: message.content ?? '',
      );
    } catch (_) {
      result = message.copyWith(status: MessageStatus.failed);
      ok = false;
    }
    if (mounted) setState(() => _messages = mergeMessages(_messages, [result]));
    return ok;
  }

  void _sendFile(File file, String fileName, {int? durationSeconds}) {
    final type = mediaTypeFor(fileName);
    if (type == null || !chatAcceptsImage(type)) {
      _showSnack("That file type isn't supported.");
      return;
    }
    final id = uuidV4();
    _pending[id] = _PendingUpload(file, fileName, type, durationSeconds);
    final optimistic = ChatMessage(
      id: id,
      chatId: widget.chatId,
      senderId: _meId,
      type: type.messageType,
      content: type.kind == UploadKind.video || type.kind == UploadKind.file ? fileName : null,
      mediaUrl: null,
      createdAt: DateTime.now().toUtc(),
      durationSeconds: durationSeconds,
      status: MessageStatus.sending,
      localPath: file.path,
      progress: 0,
    );
    setState(() => _messages = mergeMessages(_messages, [optimistic]));
    unawaited(_deliverFile(optimistic));
  }

  Future<void> _deliverFile(ChatMessage message) async {
    final upload = _pending[message.id];
    if (upload == null) return;
    var lastTick = DateTime.now();
    ChatMessage result;
    try {
      result = await ChatRepository.sendMedia(
        id: message.id,
        chatId: widget.chatId,
        senderId: _meId,
        file: upload.file,
        fileName: upload.fileName,
        type: upload.type,
        durationSeconds: upload.durationSeconds,
        onProgress: (fraction) {
          final now = DateTime.now();
          if (!mounted || now.difference(lastTick).inMilliseconds < 120) return;
          lastTick = now;
          setState(() {
            _messages = mergeMessages(_messages, [message.copyWith(progress: fraction)]);
          });
        },
      );
      _pending.remove(message.id);
      result = result.withLocalPath(message.localPath);
    } catch (e) {
      result = message.copyWith(
        status: MessageStatus.failed,
        error: e is ApiException ? e.message : 'Not sent. Please try again.',
      );
    }
    if (mounted) setState(() => _messages = mergeMessages(_messages, [result]));
  }

  void _retry(ChatMessage message) {
    final again = message.copyWith(status: MessageStatus.sending, progress: 0, clearError: true);
    setState(() => _messages = mergeMessages(_messages, [again]));
    if (message.type == 'text') {
      unawaited(_deliverText(again));
    } else {
      unawaited(_deliverFile(again));
    }
  }

  // --- Attachments -----------------------------------------------------------

  Future<void> _openAttachMenu() async {
    final choice = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Wrap(
          children: [
            _sheetItem(context, 'camera', Icons.photo_camera_outlined, 'Camera'),
            _sheetItem(context, 'photo', Icons.image_outlined, 'Photo from device'),
            _sheetItem(context, 'video', Icons.videocam_outlined, 'Video from device'),
            _sheetItem(context, 'gallery', Icons.photo_library_outlined, 'From my Gallery'),
            _sheetItem(context, 'file', Icons.attach_file, 'Document or audio file'),
          ],
        ),
      ),
    );
    if (!mounted || choice == null) return;
    try {
      switch (choice) {
        case 'camera':
          await _pickImage(ImageSource.camera);
        case 'photo':
          await _pickImage(ImageSource.gallery);
        case 'video':
          final video = await ImagePicker().pickVideo(source: ImageSource.gallery);
          if (video != null) _sendFile(File(video.path), video.name);
        case 'gallery':
          await _pickFromGallery();
        case 'file':
          final picked = await FilePicker.pickFile(type: FileType.custom, allowedExtensions: pickableDocumentExtensions);
          final path = picked?.path;
          if (picked != null && path != null) _sendFile(File(path), picked.name);
      }
    } on PlatformException catch (e) {
      _showSnack(e.code.contains('denied') ? 'Permission denied.' : "Couldn't open the picker.");
    }
  }

  Widget _sheetItem(BuildContext context, String value, IconData icon, String label) => ListTile(
        leading: Icon(icon),
        title: Text(label),
        onTap: () => Navigator.pop(context, value),
      );

  /// Re-encodes to a JPEG small enough for the 2 MB chat image cap.
  Future<void> _pickImage(ImageSource source) async {
    final picker = ImagePicker();
    var image = await picker.pickImage(source: source, maxWidth: 1600, maxHeight: 1600, imageQuality: 80);
    if (image == null) return;
    if (await image.length() > 2 * 1024 * 1024) {
      final again = await picker.pickImage(source: source, maxWidth: 1280, maxHeight: 1280, imageQuality: 60);
      if (again == null) return;
      image = again;
    }
    var name = image.name;
    if (mediaTypeFor(name)?.kind != UploadKind.image || extensionOf(name) == 'gif') name = 'photo.jpg';
    _sendFile(File(image.path), name);
  }

  Future<void> _pickFromGallery() async {
    final item = await showModalBottomSheet<GalleryItem>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => const _GalleryPickerSheet(),
    );
    if (item == null || !mounted) return;
    _showSnack('Sending ${item.fileName}…');
    try {
      final message = await GalleryRepository.forward(item.id, widget.chatId);
      if (mounted) setState(() => _messages = mergeMessages(_messages, [message]));
    } catch (e) {
      _showSnack(e is ApiException ? e.message : "Couldn't send that file.");
    }
  }

  // --- Message actions -------------------------------------------------------

  Future<void> _onLongPress(ChatMessage message) async {
    final canEdit = message.canEdit(_meId);
    final choice = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Wrap(
          children: [
            if (message.type == 'text') _sheetItem(context, 'copy', Icons.copy, 'Copy text'),
            if (canEdit) _sheetItem(context, 'edit', Icons.edit_outlined, 'Edit message'),
            if (message.publicUrl != null) _sheetItem(context, 'open', Icons.open_in_new, 'Open / download'),
          ],
        ),
      ),
    );
    if (!mounted || choice == null) return;
    switch (choice) {
      case 'copy':
        await Clipboard.setData(ClipboardData(text: message.content ?? ''));
        _showSnack('Copied');
      case 'edit':
        await _edit(message);
      case 'open':
        await openExternally(message.publicUrl!);
    }
  }

  Future<void> _edit(ChatMessage message) async {
    final controller = TextEditingController(text: message.content);
    final text = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Edit message'),
        content: TextField(
          controller: controller,
          autofocus: true,
          minLines: 1,
          maxLines: 6,
          maxLength: AppConfig.messageMaxLength,
          textCapitalization: TextCapitalization.sentences,
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, controller.text.trim()), child: const Text('Save')),
        ],
      ),
    );
    controller.dispose();
    if (text == null || text.isEmpty || text == message.content || !mounted) return;
    try {
      final updated = await ChatRepository.editMessage(message.id, text);
      if (mounted) setState(() => _messages = mergeMessages(_messages, [updated]));
    } catch (e) {
      _showSnack(e is ApiException ? e.message : "Couldn't edit the message.");
    }
  }

  Future<void> _onVoicemailPlayed(ChatMessage message) async {
    if (message.senderId == _meId || message.voicemailPlayedAt != null) return;
    final at = await ChatRepository.markVoicemailPlayed(message.id);
    if (at != null && mounted) {
      setState(() => _messages = mergeMessages(_messages, [message.copyWith(voicemailPlayedAt: at)]));
    }
  }

  // --- Chat menu -------------------------------------------------------------

  Future<bool> _confirm(String title, String body, String action, {bool destructive = true}) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Text(body),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(
            style: destructive ? FilledButton.styleFrom(backgroundColor: Theme.of(context).colorScheme.error) : null,
            onPressed: () => Navigator.pop(context, true),
            child: Text(action),
          ),
        ],
      ),
    );
    return ok == true;
  }

  Future<void> _run(Future<void> Function() action, {String? done, bool leave = false}) async {
    try {
      await action();
      if (!mounted) return;
      if (done != null) _showSnack(done);
      if (leave) Navigator.of(context).pop(chatRemoved);
    } catch (e) {
      _showSnack(chatActionError(e));
    }
  }

  Future<void> _onMenu(String value) async {
    final details = _details;
    if (details == null) return;
    switch (value) {
      case 'info':
        await _openGroupInfo();
      case 'mute':
        await _run(() async {
          await ChatRepository.setMuted(widget.chatId, !details.isMuted);
          if (mounted) setState(() => _details = details.copyWith(isMuted: !details.isMuted));
        }, done: details.isMuted ? 'Notifications on' : 'Muted');
      case 'clear':
        if (await _confirm('Clear chat?', 'Messages are removed for you only. Others still see them.', 'Clear')) {
          await _run(() async {
            await ChatRepository.clearChat(widget.chatId);
            if (mounted) setState(() => _messages = const []);
          }, done: 'Chat cleared');
        }
      case 'delete':
        if (await _confirm('Delete conversation?', 'It disappears from your list. A new message brings it back.', 'Delete')) {
          await _run(() => ChatRepository.hideChat(widget.chatId), leave: true);
        }
      case 'leave':
        if (await _confirm('Leave group?', "You won't get new messages from this group.", 'Leave')) {
          await _run(() => ChatRepository.leaveGroup(widget.chatId), leave: true);
        }
    }
  }

  Future<void> _openGroupInfo() async {
    final details = _details;
    if (details == null) return;
    final result = await Navigator.of(context).push<Object?>(
      MaterialPageRoute(builder: (_) => GroupInfoScreen(chatId: widget.chatId, me: widget.me)),
    );
    if (!mounted) return;
    if (result == chatRemoved) {
      Navigator.of(context).pop(chatRemoved);
    } else if (result is String && result.startsWith('open:')) {
      Navigator.of(context).pop(result); // DM a member: the list opens it
    } else {
      unawaited(_refreshDetails());
    }
  }

  // --- Calls -----------------------------------------------------------------

  void _call({required bool video}) {
    final details = _details;
    if (details == null) return;
    final calls = CallController.instance;
    if (calls.busy) {
      _showSnack("You're already in a call.");
      return;
    }
    if (details.isGroup) {
      unawaited(calls.joinGroup(
        chatId: widget.chatId,
        title: details.name(_meId),
        members: {for (final m in details.members) m.id: m.profile},
        video: video,
      ));
    } else {
      final other = details.other(_meId);
      if (other == null) {
        _showSnack('That account is no longer available.');
        return;
      }
      unawaited(calls.startDirect(chatId: widget.chatId, peer: other, video: video));
    }
  }

  // --- UI ----------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final details = _details;
    final other = details?.other(_meId) ?? widget.initialOther;
    final name = details?.name(_meId) ?? widget.initialName ?? '';
    final subtitle = _isGroup
        ? (details == null ? '' : '${details.members.length} members')
        : (other?.hasUsername ?? false)
            ? '@${other!.username}'
            : '';

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: InkWell(
          onTap: _isGroup ? _openGroupInfo : null,
          child: Row(
            children: [
              Avatar(
                name: name.isEmpty ? '?' : name,
                imageUrl: _isGroup ? null : other?.avatarImageUrl,
                group: _isGroup,
                size: 36,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(child: Text(name, maxLines: 1, overflow: TextOverflow.ellipsis)),
                        if (details?.isMuted ?? false)
                          const Padding(padding: EdgeInsets.only(left: 4), child: Icon(Icons.notifications_off, size: 16)),
                      ],
                    ),
                    if (subtitle.isNotEmpty) Text(subtitle, style: Theme.of(context).textTheme.bodySmall),
                  ],
                ),
              ),
            ],
          ),
        ),
        actions: [
          if (!_connected)
            const Padding(
              padding: EdgeInsets.only(right: 4),
              child: Chip(label: Text('Reconnecting…'), visualDensity: VisualDensity.compact),
            ),
          IconButton(tooltip: 'Voice call', onPressed: details == null ? null : () => _call(video: false), icon: const Icon(Icons.call_outlined)),
          IconButton(tooltip: 'Video call', onPressed: details == null ? null : () => _call(video: true), icon: const Icon(Icons.videocam_outlined)),
          PopupMenuButton<String>(
            enabled: details != null,
            onSelected: _onMenu,
            itemBuilder: (context) => [
              if (_isGroup) const PopupMenuItem(value: 'info', child: Text('Group info')),
              PopupMenuItem(value: 'mute', child: Text((details?.isMuted ?? false) ? 'Unmute' : 'Mute notifications')),
              const PopupMenuItem(value: 'clear', child: Text('Clear chat')),
              if (_isGroup)
                const PopupMenuItem(value: 'leave', child: Text('Leave group'))
              else
                const PopupMenuItem(value: 'delete', child: Text('Delete conversation')),
            ],
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            if (_groupCall != null) _GroupCallBanner(call: _groupCall!, meId: _meId, onJoin: () => _call(video: _groupCall!.callType == 'video')),
            Expanded(child: _buildMessages(context, name)),
            if (_recording)
              VoiceRecorderBar(
                onCancel: () => setState(() => _recording = false),
                onDone: (rec) {
                  setState(() => _recording = false);
                  _sendFile(rec.file, 'voice-note.m4a', durationSeconds: rec.seconds);
                },
              )
            else
              _Composer(
                onSend: _sendText,
                onSendMath: _sendMath,
                onNotice: _showSnack,
                onAttach: _openAttachMenu,
                onRecord: () => setState(() => _recording = true),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildMessages(BuildContext context, String name) {
    if (_loading && _messages.isEmpty) return const Center(child: CircularProgressIndicator());
    if (_loadError != null && _messages.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(_loadError!),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: () {
                setState(() => _loading = true);
                _load();
              },
              child: const Text('Retry'),
            ),
          ],
        ),
      );
    }
    if (_messages.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Text(
            _isGroup ? 'No messages in $name yet.\nSay hi 👋' : 'This is the start of your conversation with $name.\nSay hi 👋',
            textAlign: TextAlign.center,
            style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
          ),
        ),
      );
    }

    // reverse: true keeps the list anchored to the newest message.
    return ListView.builder(
      reverse: true,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      itemCount: _messages.length,
      itemBuilder: (context, i) {
        final index = _messages.length - 1 - i;
        final message = _messages[index];
        final previous = index > 0 ? _messages[index - 1] : null;
        final grouped = previous?.senderId == message.senderId && previous?.type != 'system';
        final mine = message.senderId == _meId;
        return _MessageBubble(
          key: ValueKey(message.id),
          message: message,
          mine: mine,
          grouped: grouped,
          senderName: _isGroup && !mine && !grouped ? profileName(_details?.member(message.senderId)) : null,
          onRetry: () => _retry(message),
          onLongPress: () => _onLongPress(message),
          onVoicemailPlayed: () => _onVoicemailPlayed(message),
        );
      },
    );
  }
}

class _GroupCallBanner extends StatelessWidget {
  const _GroupCallBanner({required this.call, required this.meId, required this.onJoin});

  final ActiveGroupCall call;
  final String meId;
  final VoidCallback onJoin;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final inIt = CallController.instance.call?.id == call.callId;
    return Material(
      color: scheme.primary.withValues(alpha: 0.12),
      child: ListTile(
        dense: true,
        leading: Icon(call.callType == 'video' ? Icons.videocam : Icons.call, color: scheme.primary),
        title: Text('${call.callType == 'video' ? 'Video' : 'Voice'} call in progress'),
        subtitle: Text('${call.participantIds.length} in the call'),
        trailing: inIt ? const Text('Joined') : FilledButton(onPressed: onJoin, child: const Text('Join')),
      ),
    );
  }
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({
    super.key,
    required this.message,
    required this.mine,
    required this.grouped,
    required this.onRetry,
    required this.onLongPress,
    required this.onVoicemailPlayed,
    this.senderName,
  });

  final ChatMessage message;
  final bool mine;
  final bool grouped;
  final String? senderName;
  final VoidCallback onRetry;
  final VoidCallback onLongPress;
  final VoidCallback onVoicemailPlayed;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final small = Theme.of(context).textTheme.labelSmall?.copyWith(color: scheme.onSurfaceVariant);

    if (message.type == 'system') {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Text(message.content ?? '', textAlign: TextAlign.center, style: small),
      );
    }

    final bubbleColor = mine ? scheme.primary : scheme.surfaceContainerHigh;
    final textColor = mine ? scheme.onPrimary : scheme.onSurface;
    const r = Radius.circular(18);
    const tail = Radius.circular(6);
    final isImage = message.type == 'image';

    final Widget status = switch (message.status) {
      MessageStatus.sending => Text(
          message.progress != null && message.isMedia ? 'Uploading ${(message.progress! * 100).round()}%' : 'Sending…',
          style: small,
        ),
      MessageStatus.failed => Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Flexible(child: Text(message.error ?? 'Not sent', style: small?.copyWith(color: scheme.error))),
            TextButton(
              onPressed: onRetry,
              style: TextButton.styleFrom(
                visualDensity: VisualDensity.compact,
                padding: const EdgeInsets.symmetric(horizontal: 6),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              child: const Text('Retry'),
            ),
          ],
        ),
      MessageStatus.sent => Text(
          '${formatMessageTime(context, message.createdAt)}${message.isEdited ? ' · (edited)' : ''}',
          style: small,
        ),
    };

    return Padding(
      padding: EdgeInsets.only(top: grouped ? 2 : 10),
      child: Align(
        alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.78),
          child: Column(
            crossAxisAlignment: mine ? CrossAxisAlignment.end : CrossAxisAlignment.start,
            children: [
              if (senderName != null)
                Padding(
                  padding: const EdgeInsets.only(left: 6, bottom: 2),
                  child: Text(senderName!, style: small?.copyWith(color: scheme.primary, fontWeight: FontWeight.w600)),
                ),
              GestureDetector(
                onLongPress: message.status == MessageStatus.sent ? onLongPress : null,
                child: Opacity(
                  opacity: message.status == MessageStatus.sending ? 0.75 : 1,
                  child: Container(
                    padding: isImage ? const EdgeInsets.all(3) : const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
                    decoration: BoxDecoration(
                      color: bubbleColor,
                      borderRadius: BorderRadius.only(
                        topLeft: r,
                        topRight: r,
                        bottomLeft: mine ? r : tail,
                        bottomRight: mine ? tail : r,
                      ),
                    ),
                    child: _content(context, textColor),
                  ),
                ),
              ),
              if (message.status == MessageStatus.sending && message.progress != null && message.isMedia)
                SizedBox(width: 120, child: LinearProgressIndicator(value: message.progress)),
              Padding(padding: const EdgeInsets.only(top: 2, left: 4, right: 4), child: status),
            ],
          ),
        ),
      ),
    );
  }

  Widget _content(BuildContext context, Color textColor) {
    final url = message.publicUrl;
    final local = message.localPath;
    switch (message.type) {
      case 'text':
        final math = parseMathResultMessage(message.content);
        if (math != null) {
          return MathResultCard(expression: math.expression, result: math.result, mine: mine, foreground: textColor);
        }
        return Text(message.content ?? '', style: TextStyle(color: textColor, fontSize: 15, height: 1.3));
      case 'image':
        final Widget image = local != null && File(local).existsSync()
            ? Image.file(File(local), fit: BoxFit.cover)
            : url != null
                ? Image.network(
                    url,
                    fit: BoxFit.cover,
                    loadingBuilder: (context, child, p) =>
                        p == null ? child : const SizedBox(height: 180, child: Center(child: CircularProgressIndicator())),
                    errorBuilder: (_, _, _) => _unavailable(textColor, Icons.broken_image_outlined, 'Image unavailable'),
                  )
                : _unavailable(textColor, Icons.image_outlined, 'Image');
        return GestureDetector(
          onTap: url == null && local == null
              ? null
              : () => Navigator.of(context).push(MaterialPageRoute<void>(
                    builder: (_) => ImageViewerScreen(url: url, localPath: url == null ? local : null),
                  )),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(15),
            child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 260, maxHeight: 320), child: image),
          ),
        );
      case 'video':
        return _FileTile(
          icon: Icons.play_circle_fill,
          name: message.content ?? 'Video',
          color: textColor,
          onTap: url == null && local == null
              ? null
              : () => Navigator.of(context).push(MaterialPageRoute<void>(
                    builder: (_) => VideoScreen(url: url, localPath: url == null ? local : null, title: message.content),
                  )),
        );
      case 'audio' || 'voicemail':
        final voicemail = message.type == 'voicemail';
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            if (voicemail)
              Padding(
                padding: const EdgeInsets.only(top: 2, left: 4),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.voicemail, size: 16, color: textColor),
                    const SizedBox(width: 6),
                    Text(
                      mine
                          ? 'Voicemail${message.voicemailPlayedAt != null ? ' · Played' : ''}'
                          : message.voicemailPlayedAt == null
                              ? 'New voicemail'
                              : 'Voicemail',
                      style: TextStyle(color: textColor, fontWeight: FontWeight.w600, fontSize: 13),
                    ),
                  ],
                ),
              ),
            AudioPlayerBar(
              url: url,
              localPath: url == null ? local : null,
              durationSeconds: message.durationSeconds,
              foreground: textColor,
              onFirstPlay: voicemail ? onVoicemailPlayed : null,
            ),
          ],
        );
      case 'file':
        return _FileTile(
          icon: iconForFile(message.content ?? ''),
          name: message.content ?? 'File',
          color: textColor,
          onTap: url == null ? null : () => openExternally(url),
        );
      default:
        return Text('Unsupported message', style: TextStyle(color: textColor, fontStyle: FontStyle.italic));
    }
  }

  Widget _unavailable(Color color, IconData icon, String label) => SizedBox(
        width: 200,
        height: 120,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [Icon(icon, color: color), Text(label, style: TextStyle(color: color))],
        ),
      );
}

class _FileTile extends StatelessWidget {
  const _FileTile({required this.icon, required this.name, required this.color, this.onTap});

  final IconData icon;
  final String name;
  final Color color;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => InkWell(
        onTap: onTap,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: color, size: 32),
            const SizedBox(width: 10),
            Flexible(
              child: Text(
                name,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: color, fontWeight: FontWeight.w500),
              ),
            ),
          ],
        ),
      );
}

class _Composer extends StatefulWidget {
  const _Composer({
    required this.onSend,
    required this.onSendMath,
    required this.onNotice,
    required this.onAttach,
    required this.onRecord,
  });

  final ValueChanged<String> onSend;

  /// A valid `/math` command, already evaluated: (expression, formatted result).
  final void Function(String expression, String formatted) onSendMath;
  final ValueChanged<String> onNotice;
  final VoidCallback onAttach;
  final VoidCallback onRecord;

  @override
  State<_Composer> createState() => _ComposerState();
}

class _ComposerState extends State<_Composer> {
  final _controller = TextEditingController();
  final _focus = FocusNode();

  @override
  void dispose() {
    _controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  void _submit() {
    final content = _controller.text.trim();
    if (content.isEmpty) return;
    if (isMathCommand(content)) {
      // Never send a broken command as text.
      final expression = parseMathCommand(content) ?? '';
      switch (evaluateMath(expression)) {
        case MathOk(:final formatted) when expression.isNotEmpty:
          widget.onSendMath(expression, formatted);
        case MathError(:final error):
          widget.onNotice('Invalid math expression: $error');
          return;
        default:
          widget.onNotice('Invalid math expression');
          return;
      }
    } else {
      widget.onSend(content);
    }
    _controller.clear();
    setState(() {});
    _focus.requestFocus();
  }

  void _completeMath() {
    _controller.value = const TextEditingValue(text: '/math ', selection: TextSelection.collapsed(offset: 6));
    setState(() {});
    _focus.requestFocus();
  }

  /// Hint / live result above the input while a `/math` command is typed.
  Widget? _mathBar(BuildContext context) {
    final text = _controller.text;
    final expression = parseMathCommand(text);
    if (expression == null) return null;
    final scheme = Theme.of(context).colorScheme;
    final muted = TextStyle(color: scheme.onSurfaceVariant, fontSize: 13);
    final mono = TextStyle(fontFamily: 'monospace', color: scheme.onSurface, fontSize: 13);

    Widget content;
    VoidCallback? onTap;
    if (expression.isEmpty) {
      onTap = isMathCommand(text) ? null : _completeMath; // "/" … "/mat": tap fills in "/math "
      content = Text.rich(
        TextSpan(children: [
          TextSpan(text: '/math', style: mono.copyWith(color: scheme.primary, fontWeight: FontWeight.w700)),
          TextSpan(text: ' [expression]', style: mono),
          const TextSpan(text: ' — Instant calculator (e.g. '),
          TextSpan(text: '/math (120 * 4) / 3', style: mono),
          const TextSpan(text: ')'),
        ]),
        style: muted,
      );
    } else {
      content = switch (evaluateMath(expression)) {
        MathOk(:final formatted) => Text(
            '= $formatted',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: scheme.primary,
              fontSize: 18,
              fontWeight: FontWeight.w700,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        MathError(:final error) => Text(
            error,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(color: Colors.amber.shade700, fontSize: 13),
          ),
      };
    }

    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 8, 8, 0),
      child: Material(
        color: scheme.surfaceContainerHigh,
        borderRadius: BorderRadius.circular(14),
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
            child: Semantics(
              liveRegion: true,
              child: Row(
                children: [
                  const Text('🧮', style: TextStyle(fontSize: 18)),
                  const SizedBox(width: 10),
                  Expanded(child: content),
                  if (onTap != null) ...[
                    const SizedBox(width: 8),
                    Text('Tap to use', style: muted.copyWith(fontSize: 11)),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final empty = _controller.text.trim().isEmpty;
    final mathBar = _mathBar(context);
    return Container(
      decoration: BoxDecoration(border: Border(top: BorderSide(color: scheme.outlineVariant))),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          AnimatedSize(
            duration: const Duration(milliseconds: 150),
            alignment: Alignment.bottomCenter,
            child: mathBar ?? const SizedBox(width: double.infinity),
          ),
          Padding(padding: const EdgeInsets.fromLTRB(4, 8, 8, 8), child: _inputRow(scheme, empty)),
        ],
      ),
    );
  }

  Widget _inputRow(ColorScheme scheme, bool empty) {
    return Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          IconButton(tooltip: 'Attach', onPressed: widget.onAttach, icon: const Icon(Icons.add_circle_outline)),
          Expanded(
            child: TextField(
              controller: _controller,
              focusNode: _focus,
              minLines: 1,
              maxLines: 6,
              maxLength: AppConfig.messageMaxLength,
              textCapitalization: TextCapitalization.sentences,
              keyboardType: TextInputType.multiline,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                hintText: 'Message',
                counterText: '',
                isDense: true,
                filled: true,
                fillColor: scheme.surfaceContainerHighest.withValues(alpha: 0.5),
                contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(22), borderSide: BorderSide.none),
              ),
            ),
          ),
          const SizedBox(width: 6),
          empty
              ? IconButton.filled(tooltip: 'Record voice message', onPressed: widget.onRecord, icon: const Icon(Icons.mic))
              : IconButton.filled(tooltip: 'Send', onPressed: _submit, icon: const Icon(Icons.send_rounded)),
        ],
    );
  }
}

/// Pick an item from my gallery to send into the chat.
class _GalleryPickerSheet extends StatefulWidget {
  const _GalleryPickerSheet();

  @override
  State<_GalleryPickerSheet> createState() => _GalleryPickerSheetState();
}

class _GalleryPickerSheetState extends State<_GalleryPickerSheet> {
  late final Future<List<GalleryItem>> _items = GalleryRepository.list();

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: MediaQuery.sizeOf(context).height * 0.7,
      child: FutureBuilder<List<GalleryItem>>(
        future: _items,
        builder: (context, snapshot) {
          if (snapshot.hasError) return const Center(child: Text("Couldn't load your gallery."));
          if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
          final items = snapshot.data!;
          if (items.isEmpty) {
            return const Center(child: Text('Your gallery is empty.\nAdd files from Menu → Gallery.', textAlign: TextAlign.center));
          }
          return GridView.builder(
            padding: const EdgeInsets.all(12),
            gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(maxCrossAxisExtent: 130, mainAxisSpacing: 8, crossAxisSpacing: 8),
            itemCount: items.length,
            itemBuilder: (context, i) => GalleryThumb(item: items[i], onTap: () => Navigator.pop(context, items[i])),
          );
        },
      ),
    );
  }
}

/// Square thumbnail for a gallery item (shared with the gallery screen).
class GalleryThumb extends StatelessWidget {
  const GalleryThumb({super.key, required this.item, this.onTap, this.onLongPress});

  final GalleryItem item;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final url = item.url;
    final Widget body = item.kind == 'image' && url != null
        ? Image.network(url, fit: BoxFit.cover, cacheWidth: 300, errorBuilder: (_, _, _) => const Icon(Icons.broken_image_outlined))
        : Padding(
            padding: const EdgeInsets.all(8),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  switch (item.kind) {
                    'video' => Icons.play_circle_outline,
                    'audio' => Icons.audiotrack,
                    _ => iconForFile(item.fileName),
                  },
                  size: 36,
                  color: scheme.primary,
                ),
                const SizedBox(height: 6),
                Text(item.fileName, maxLines: 2, overflow: TextOverflow.ellipsis, textAlign: TextAlign.center, style: const TextStyle(fontSize: 11)),
              ],
            ),
          );
    return Material(
      color: scheme.surfaceContainerHigh,
      borderRadius: BorderRadius.circular(12),
      clipBehavior: Clip.antiAlias,
      child: InkWell(onTap: onTap, onLongPress: onLongPress, child: SizedBox.expand(child: body)),
    );
  }
}
