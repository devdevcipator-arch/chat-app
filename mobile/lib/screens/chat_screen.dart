import 'dart:async';

import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../core/config.dart';
import '../core/errors.dart';
import '../core/ids.dart';
import '../core/supabase.dart';
import '../core/time_format.dart';
import '../data/chat_repository.dart';
import '../models/chat_message.dart';
import '../models/profile.dart';
import '../widgets/avatar.dart';

class ChatScreen extends StatefulWidget {
  const ChatScreen({
    super.key,
    required this.chatId,
    required this.me,
    this.initialOther,
  });

  final String chatId;
  final Profile me;

  /// Shown immediately in the header while the participant loads.
  final Profile? initialOther;

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  late Profile? _other = widget.initialOther;
  List<ChatMessage> _messages = const [];
  bool _loading = true;
  String? _loadError;
  bool _connected = true;
  RealtimeChannel? _channel;

  @override
  void initState() {
    super.initState();
    _load();
    _subscribe();
  }

  @override
  void dispose() {
    final channel = _channel;
    if (channel != null) supabase.removeChannel(channel);
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        ChatRepository.otherParticipant(widget.chatId, widget.me.id),
        ChatRepository.recentMessages(widget.chatId),
      ]);
      if (!mounted) return;
      setState(() {
        _other = results[0] as Profile? ?? _other;
        _messages = mergeMessages(_messages, results[1] as List<ChatMessage>);
        _loading = false;
        _loadError = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _loadError = dbErrorMessage(e);
      });
    }
  }

  // Realtime: append new messages for this chat as they are inserted.
  void _subscribe() {
    _channel = supabase
        .channel('chat:${widget.chatId}')
        .onPostgresChanges(
          event: PostgresChangeEvent.insert,
          schema: 'public',
          table: 'messages',
          filter: PostgresChangeFilter(
            type: PostgresChangeFilterType.eq,
            column: 'chat_id',
            value: widget.chatId,
          ),
          callback: (payload) {
            if (!mounted) return;
            final message = ChatMessage.fromMap(payload.newRecord);
            setState(() => _messages = mergeMessages(_messages, [message]));
          },
        )
        .subscribe((status, error) {
          if (!mounted) return;
          if (status == RealtimeSubscribeStatus.subscribed) {
            setState(() => _connected = true);
            _catchUp();
          } else if (status == RealtimeSubscribeStatus.channelError ||
              status == RealtimeSubscribeStatus.timedOut) {
            setState(() => _connected = false);
          }
        });
  }

  /// Covers anything sent between the initial load and (re)subscribing.
  Future<void> _catchUp() async {
    try {
      final recent = await ChatRepository.recentMessages(widget.chatId);
      if (mounted) setState(() => _messages = mergeMessages(_messages, recent));
    } catch (_) {
      // Non-fatal: the live stream and pull-to-retry still work.
    }
  }

  void _send(String content) {
    final optimistic = ChatMessage(
      id: uuidV4(),
      chatId: widget.chatId,
      senderId: widget.me.id,
      type: 'text',
      content: content,
      mediaUrl: null,
      createdAt: DateTime.now().toUtc(),
      status: MessageStatus.sending,
    );
    setState(() => _messages = mergeMessages(_messages, [optimistic]));
    _deliver(optimistic);
  }

  Future<void> _deliver(ChatMessage message) async {
    ChatMessage result;
    try {
      result = await ChatRepository.sendText(
        id: message.id,
        chatId: widget.chatId,
        senderId: widget.me.id,
        content: message.content ?? '',
      );
    } catch (_) {
      result = message.copyWith(status: MessageStatus.failed);
    }
    if (mounted) setState(() => _messages = mergeMessages(_messages, [result]));
  }

  void _retry(ChatMessage message) {
    final again = message.copyWith(status: MessageStatus.sending);
    setState(() => _messages = mergeMessages(_messages, [again]));
    _deliver(again);
  }

  @override
  Widget build(BuildContext context) {
    final other = _other;
    final name = other?.name ?? (_loading ? '' : 'Deleted user');

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: Row(
          children: [
            Avatar(name: name.isEmpty ? '?' : name, size: 36),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(name, maxLines: 1, overflow: TextOverflow.ellipsis),
                  if (other?.hasUsername ?? false)
                    Text(
                      '@${other!.username}',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                ],
              ),
            ),
          ],
        ),
        actions: [
          if (!_connected)
            const Padding(
              padding: EdgeInsets.only(right: 12),
              child: Chip(
                label: Text('Reconnecting…'),
                visualDensity: VisualDensity.compact,
              ),
            ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(child: _buildMessages(context, name)),
            _Composer(onSend: _send),
          ],
        ),
      ),
    );
  }

  Widget _buildMessages(BuildContext context, String name) {
    if (_loading && _messages.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
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
            'This is the start of your conversation with $name.\nSay hi 👋',
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
        return _MessageBubble(
          key: ValueKey(message.id),
          message: message,
          mine: message.senderId == widget.me.id,
          grouped: previous?.senderId == message.senderId,
          onRetry: () => _retry(message),
        );
      },
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
  });

  final ChatMessage message;
  final bool mine;
  final bool grouped;
  final VoidCallback onRetry;

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

    final bubbleColor = mine ? scheme.primary : scheme.surfaceContainerHighest;
    final textColor = mine ? scheme.onPrimary : scheme.onSurface;
    const r = Radius.circular(18);
    const tail = Radius.circular(6);

    final Widget status = switch (message.status) {
      MessageStatus.sending => Text('Sending…', style: small),
      MessageStatus.failed => Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Not sent', style: small?.copyWith(color: scheme.error)),
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
      MessageStatus.sent => Text(formatMessageTime(context, message.createdAt), style: small),
    };

    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: const Duration(milliseconds: 180),
      curve: Curves.easeOut,
      builder: (context, t, child) => Opacity(
        opacity: t,
        child: Transform.translate(offset: Offset(0, (1 - t) * 8), child: child),
      ),
      child: Padding(
        padding: EdgeInsets.only(top: grouped ? 2 : 10),
        child: Align(
          alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
          child: ConstrainedBox(
            constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.78),
            child: Column(
              crossAxisAlignment: mine ? CrossAxisAlignment.end : CrossAxisAlignment.start,
              children: [
                Opacity(
                  opacity: message.status == MessageStatus.sending ? 0.7 : 1,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
                    decoration: BoxDecoration(
                      color: bubbleColor,
                      borderRadius: BorderRadius.only(
                        topLeft: r,
                        topRight: r,
                        bottomLeft: mine ? r : tail,
                        bottomRight: mine ? tail : r,
                      ),
                    ),
                    child: Text(
                      message.type == 'text' ? (message.content ?? '') : 'Unsupported message type',
                      style: TextStyle(
                        color: textColor,
                        fontSize: 15,
                        height: 1.3,
                        fontStyle: message.type == 'text' ? FontStyle.normal : FontStyle.italic,
                      ),
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.only(top: 2, left: 4, right: 4),
                  child: status,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Composer extends StatefulWidget {
  const _Composer({required this.onSend});

  final ValueChanged<String> onSend;

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
    widget.onSend(content);
    _controller.clear();
    _focus.requestFocus();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: scheme.outlineVariant)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
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
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(22),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
          ),
          const SizedBox(width: 6),
          IconButton.filled(
            tooltip: 'Send',
            onPressed: _controller.text.trim().isEmpty ? null : _submit,
            icon: const Icon(Icons.send_rounded),
          ),
        ],
      ),
    );
  }
}
