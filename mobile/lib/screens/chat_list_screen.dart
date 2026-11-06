import 'dart:async';

import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../core/errors.dart';
import '../core/supabase.dart';
import '../core/time_format.dart';
import '../core/username.dart';
import '../data/chat_repository.dart';
import '../data/profile_repository.dart';
import '../models/chat_message.dart';
import '../models/chat_summary.dart';
import '../models/profile.dart';
import '../widgets/avatar.dart';
import 'chat_screen.dart';

class ChatListScreen extends StatefulWidget {
  const ChatListScreen({super.key, required this.me});

  final Profile me;

  @override
  State<ChatListScreen> createState() => _ChatListScreenState();
}

class _ChatListScreenState extends State<ChatListScreen> {
  List<ChatSummary> _chats = const [];
  bool _loading = true;
  String? _loadError;
  RealtimeChannel? _channel;

  @override
  void initState() {
    super.initState();
    _refresh();
    _subscribe();
  }

  @override
  void dispose() {
    final channel = _channel;
    if (channel != null) supabase.removeChannel(channel);
    super.dispose();
  }

  Future<void> _refresh() async {
    try {
      final chats = await ChatRepository.listMyChats();
      if (!mounted) return;
      setState(() {
        _chats = chats;
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

  // Live updates: new messages in any of my chats (RLS filters the stream to
  // chats I'm in) and new chats someone else started with me.
  void _subscribe() {
    _channel = supabase
        .channel('sidebar:${widget.me.id}')
        .onPostgresChanges(
          event: PostgresChangeEvent.insert,
          schema: 'public',
          table: 'messages',
          callback: (payload) {
            final message = ChatMessage.fromMap(payload.newRecord);
            final index = _chats.indexWhere((c) => c.chatId == message.chatId);
            if (index < 0) {
              _refresh();
              return;
            }
            final updated = _chats[index].withLastMessage(LastMessage(
              content: message.content,
              type: message.type,
              senderId: message.senderId,
              createdAt: message.createdAt,
            ));
            if (!mounted) return;
            setState(() {
              _chats = [updated, ..._chats.where((c) => c.chatId != message.chatId)];
            });
          },
        )
        .onPostgresChanges(
          event: PostgresChangeEvent.insert,
          schema: 'public',
          table: 'chat_participants',
          filter: PostgresChangeFilter(
            type: PostgresChangeFilterType.eq,
            column: 'user_id',
            value: widget.me.id,
          ),
          callback: (_) => _refresh(),
        )
        .subscribe((status, error) {
          // Catch up on anything missed while (re)connecting.
          if (status == RealtimeSubscribeStatus.subscribed) _refresh();
        });
  }

  Future<void> _openChat(String chatId, {Profile? other}) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ChatScreen(chatId: chatId, me: widget.me, initialOther: other),
      ),
    );
    if (mounted) _refresh();
  }

  Future<String?> _startChat(Profile other) async {
    try {
      final chatId = await ChatRepository.createDirectChat(other.id);
      if (!mounted) return null;
      unawaited(_refresh());
      unawaited(_openChat(chatId, other: other));
      return null;
    } catch (e) {
      return e is PostgrestException && e.code == 'P0002'
          ? 'That user no longer exists.'
          : "Couldn't start the chat. Please try again.";
    }
  }

  Future<void> _confirmSignOut() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Sign out?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Sign out')),
        ],
      ),
    );
    if (confirmed == true) await supabase.auth.signOut();
  }

  @override
  Widget build(BuildContext context) {
    final me = widget.me;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Chats'),
        actions: [
          PopupMenuButton<String>(
            tooltip: 'Account',
            icon: Avatar(name: me.name, size: 32),
            onSelected: (value) {
              if (value == 'signout') _confirmSignOut();
            },
            itemBuilder: (context) => [
              PopupMenuItem<String>(
                enabled: false,
                child: ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Avatar(name: me.name),
                  title: Text(me.name),
                  subtitle: Text('@${me.username}'),
                ),
              ),
              const PopupMenuDivider(),
              const PopupMenuItem<String>(
                value: 'signout',
                child: ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(Icons.logout),
                  title: Text('Sign out'),
                ),
              ),
            ],
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: Column(
        children: [
          _UserSearch(meId: me.id, onStartChat: _startChat),
          Expanded(child: _buildList(context)),
        ],
      ),
    );
  }

  Widget _buildList(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());

    if (_loadError != null && _chats.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(_loadError!, textAlign: TextAlign.center),
              const SizedBox(height: 12),
              OutlinedButton(onPressed: _refresh, child: const Text('Retry')),
            ],
          ),
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _refresh,
      child: _chats.isEmpty
          ? ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              children: const [
                Padding(
                  padding: EdgeInsets.fromLTRB(32, 64, 32, 0),
                  child: Text(
                    'No conversations yet.\nSearch for an @username to start one.',
                    textAlign: TextAlign.center,
                  ),
                ),
              ],
            )
          : ListView.separated(
              physics: const AlwaysScrollableScrollPhysics(),
              itemCount: _chats.length,
              separatorBuilder: (_, _) => const Divider(height: 1, indent: 72),
              itemBuilder: (context, i) => _ChatTile(
                chat: _chats[i],
                meId: widget.me.id,
                onTap: () => _openChat(_chats[i].chatId, other: _chats[i].other),
              ),
            ),
    );
  }
}

class _ChatTile extends StatelessWidget {
  const _ChatTile({required this.chat, required this.meId, required this.onTap});

  final ChatSummary chat;
  final String meId;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final other = chat.other;
    final name = other?.name ?? 'Deleted user';
    final last = chat.lastMessage;
    final snippet = last == null
        ? 'No messages yet'
        : '${last.senderId == meId ? 'You: ' : ''}${messageSnippet(last.type, last.content)}';

    return ListTile(
      onTap: onTap,
      leading: Avatar(name: name, size: 44),
      title: Row(
        children: [
          Expanded(child: Text(name, maxLines: 1, overflow: TextOverflow.ellipsis)),
          const SizedBox(width: 8),
          Text(
            formatListTime(context, chat.lastActivity),
            style: Theme.of(context).textTheme.labelSmall?.copyWith(color: scheme.onSurfaceVariant),
          ),
        ],
      ),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (other?.hasUsername ?? false)
            Text(
              '@${other!.username}',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
            ),
          Text(snippet, maxLines: 1, overflow: TextOverflow.ellipsis),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Exact @username search
// ---------------------------------------------------------------------------

sealed class _SearchState {
  const _SearchState();
}

class _Idle extends _SearchState {
  const _Idle();
}

class _Searching extends _SearchState {
  const _Searching();
}

class _Found extends _SearchState {
  const _Found(this.profile);
  final Profile profile;
}

class _Self extends _SearchState {
  const _Self();
}

class _NotFound extends _SearchState {
  const _NotFound(this.username);
  final String username;
}

class _Failed extends _SearchState {
  const _Failed(this.message);
  final String message;
}

class _UserSearch extends StatefulWidget {
  const _UserSearch({required this.meId, required this.onStartChat});

  final String meId;

  /// Returns an error message, or null on success.
  final Future<String?> Function(Profile other) onStartChat;

  @override
  State<_UserSearch> createState() => _UserSearchState();
}

class _UserSearchState extends State<_UserSearch> {
  final _controller = TextEditingController();
  _SearchState _state = const _Idle();
  bool _starting = false;
  Timer? _timer;
  String _latest = '';

  @override
  void dispose() {
    _timer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _onChanged(String username) {
    _timer?.cancel();
    _latest = username;
    if (!isValidUsername(username)) {
      setState(() => _state = const _Idle());
      return;
    }
    setState(() => _state = const _Searching());
    _timer = Timer(const Duration(milliseconds: 350), () => _lookup(username));
  }

  Future<void> _lookup(String username) async {
    _SearchState next;
    try {
      final profile = await ProfileRepository.findByUsername(username);
      next = profile == null
          ? _NotFound(username)
          : profile.id == widget.meId
              ? const _Self()
              : _Found(profile);
    } catch (_) {
      next = const _Failed('Search failed. Try again.');
    }
    if (!mounted || _latest != username) return;
    setState(() => _state = next);
  }

  Future<void> _start(Profile profile) async {
    setState(() => _starting = true);
    final error = await widget.onStartChat(profile);
    if (!mounted) return;
    setState(() {
      _starting = false;
      if (error == null) {
        _controller.clear();
        _latest = '';
        _state = const _Idle();
      } else {
        _state = _Failed(error);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
      child: Column(
        children: [
          TextField(
            controller: _controller,
            autocorrect: false,
            enableSuggestions: false,
            textInputAction: TextInputAction.search,
            inputFormatters: [UsernameInputFormatter()],
            onChanged: _onChanged,
            onSubmitted: (_) {
              final state = _state;
              if (state is _Found && !_starting) _start(state.profile);
            },
            decoration: InputDecoration(
              hintText: 'Find by exact username',
              prefixIcon: const Icon(Icons.search),
              prefixText: '@',
              isDense: true,
              filled: true,
              fillColor: scheme.surfaceContainerHighest.withValues(alpha: 0.5),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide.none,
              ),
              suffixIcon: _controller.text.isEmpty
                  ? null
                  : IconButton(
                      tooltip: 'Clear',
                      icon: const Icon(Icons.close),
                      onPressed: () {
                        _controller.clear();
                        _onChanged('');
                      },
                    ),
            ),
          ),
          AnimatedSize(
            duration: const Duration(milliseconds: 150),
            child: _buildResult(context),
          ),
        ],
      ),
    );
  }

  Widget _buildResult(BuildContext context) {
    final muted = TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant);
    final Widget? body = switch (_state) {
      _Idle() => null,
      _Searching() => const ListTile(
          dense: true,
          leading: SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2)),
          title: Text('Searching…'),
        ),
      _NotFound(:final username) => ListTile(dense: true, title: Text('No one goes by @$username.', style: muted)),
      _Self() => ListTile(dense: true, title: Text("That's you.", style: muted)),
      _Failed(:final message) => ListTile(
          dense: true,
          title: Text(message, style: TextStyle(color: Theme.of(context).colorScheme.error)),
        ),
      _Found(:final profile) => ListTile(
          leading: Avatar(name: profile.name),
          title: Text(profile.name, maxLines: 1, overflow: TextOverflow.ellipsis),
          subtitle: Text('@${profile.username}'),
          trailing: FilledButton(
            onPressed: _starting ? null : () => _start(profile),
            child: _starting
                ? const SizedBox.square(dimension: 16, child: CircularProgressIndicator(strokeWidth: 2))
                : const Text('Start chat'),
          ),
        ),
    };
    if (body == null) return const SizedBox(width: double.infinity);
    return Card(
      margin: const EdgeInsets.only(top: 8),
      child: Semantics(liveRegion: true, child: body),
    );
  }
}
