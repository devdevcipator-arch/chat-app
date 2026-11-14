import 'dart:async';

import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/errors.dart';
import '../core/supabase.dart';
import '../core/time_format.dart';
import '../core/username.dart';
import '../data/chat_repository.dart';
import '../data/profile_repository.dart';
import '../models/chat_message.dart';
import '../models/chat_summary.dart';
import '../models/profile.dart';
import '../services/call_controller.dart';
import '../widgets/avatar.dart';
import 'calls_tab.dart';
import 'chat_screen.dart';
import 'gallery_screen.dart';
import 'new_group_screen.dart';
import 'settings_screen.dart';

class ChatListScreen extends StatefulWidget {
  const ChatListScreen({super.key, required this.me, required this.onProfileChanged});

  final Profile me;
  final ValueChanged<Profile> onProfileChanged;

  @override
  State<ChatListScreen> createState() => _ChatListScreenState();
}

class _ChatListScreenState extends State<ChatListScreen> {
  late Profile _me = widget.me;
  List<ChatSummary> _chats = const [];
  bool _loading = true;
  String? _loadError;
  RealtimeChannel? _channel;
  Timer? _refreshDebounce;

  /// The chat currently open on top of the list (its unread count stays 0).
  String? _openChatId;

  @override
  void initState() {
    super.initState();
    _refresh();
    _subscribe();
    unawaited(CallController.instance.attach(widget.me.id));
  }

  @override
  void didUpdateWidget(ChatListScreen old) {
    super.didUpdateWidget(old);
    if (old.me != widget.me) _me = widget.me;
  }

  @override
  void dispose() {
    _refreshDebounce?.cancel();
    _groupFilter.dispose();
    final channel = _channel;
    if (channel != null) unawaited(supabase.removeChannel(channel));
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

  void _refreshSoon() {
    _refreshDebounce?.cancel();
    _refreshDebounce = Timer(const Duration(milliseconds: 400), _refresh);
  }

  // Live updates: new messages in any of my chats (RLS filters the stream to
  // chats I'm in), and my own membership rows (new chats, mute, clear, hide).
  void _subscribe() {
    final meFilter = PostgresChangeFilter(type: PostgresChangeFilterType.eq, column: 'user_id', value: widget.me.id);
    _channel = supabase
        .channel('sidebar:${widget.me.id}')
        .onPostgresChanges(
          event: PostgresChangeEvent.insert,
          schema: 'public',
          table: 'messages',
          callback: (payload) {
            final message = ChatMessage.fromMap(payload.newRecord);
            final index = _chats.indexWhere((c) => c.chatId == message.chatId);
            if (index < 0 || message.type == 'system') {
              _refreshSoon(); // new chat, or a rename/membership change
              return;
            }
            final chat = _chats[index];
            final fromOther = message.senderId != widget.me.id && _openChatId != message.chatId;
            final updated = chat.copyWith(
              lastMessage: LastMessage(
                content: message.content,
                type: message.type,
                senderId: message.senderId,
                createdAt: message.createdAt,
                durationSeconds: message.durationSeconds,
              ),
              unreadCount: fromOther ? chat.unreadCount + 1 : chat.unreadCount,
            );
            if (!mounted) return;
            setState(() => _chats = [updated, ..._chats.where((c) => c.chatId != message.chatId)]);
          },
        )
        .onPostgresChanges(
          event: PostgresChangeEvent.all,
          schema: 'public',
          table: 'chat_participants',
          filter: meFilter,
          callback: (_) => _refreshSoon(),
        )
        .subscribe((status, error) {
          // Catch up on anything missed while (re)connecting.
          if (status == RealtimeSubscribeStatus.subscribed) _refreshSoon();
        });
  }

  Future<void> _openChat(String chatId, {ChatSummary? summary, Profile? other}) async {
    _openChatId = chatId;
    setState(() {
      _chats = [for (final c in _chats) c.chatId == chatId ? c.copyWith(unreadCount: 0) : c];
    });
    final result = await Navigator.of(context).push<Object?>(
      MaterialPageRoute(
        builder: (_) => ChatScreen(
          chatId: chatId,
          me: _me,
          initialName: summary?.name ?? other?.name,
          initialOther: summary?.other ?? other,
          initialIsGroup: summary?.isGroup ?? false,
        ),
      ),
    );
    _openChatId = null;
    if (!mounted) return;
    if (result == chatRemoved) {
      setState(() => _chats = _chats.where((c) => c.chatId != chatId).toList());
    }
    unawaited(_refresh());
    if (result is String && result.startsWith('open:')) {
      unawaited(_openChat(result.substring(5)));
    }
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

  Future<void> _newGroup() async {
    final chatId = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => NewGroupScreen(me: _me)),
    );
    if (chatId == null || !mounted) return;
    await _refresh();
    if (!mounted) return;
    final summary = _chats.where((c) => c.chatId == chatId).firstOrNull;
    unawaited(_openChat(chatId, summary: summary));
  }

  void _openSettings() {
    Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => SettingsScreen(
        me: _me,
        onProfileChanged: (p) {
          if (mounted) setState(() => _me = p);
          widget.onProfileChanged(p);
        },
      ),
    ));
  }

  void _openGallery() => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const GalleryScreen()));

  Future<void> _chatActions(ChatSummary chat) async {
    final choice = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Wrap(
          children: [
            ListTile(title: Text(chat.name, style: Theme.of(context).textTheme.titleMedium)),
            ListTile(
              leading: Icon(chat.isMuted ? Icons.notifications_active_outlined : Icons.notifications_off_outlined),
              title: Text(chat.isMuted ? 'Unmute' : 'Mute notifications'),
              onTap: () => Navigator.pop(context, 'mute'),
            ),
            ListTile(
              leading: Icon(chat.isGroup ? Icons.logout : Icons.delete_outline, color: Theme.of(context).colorScheme.error),
              title: Text(
                chat.isGroup ? 'Leave group' : 'Delete conversation',
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
              onTap: () => Navigator.pop(context, 'remove'),
            ),
          ],
        ),
      ),
    );
    if (!mounted || choice == null) return;
    try {
      if (choice == 'mute') {
        await ChatRepository.setMuted(chat.chatId, !chat.isMuted);
        if (mounted) {
          setState(() => _chats = [for (final c in _chats) c.chatId == chat.chatId ? c.copyWith(isMuted: !chat.isMuted) : c]);
        }
      } else {
        final ok = await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: Text(chat.isGroup ? 'Leave ${chat.name}?' : 'Delete conversation?'),
            content: Text(chat.isGroup
                ? "You won't get new messages from this group."
                : 'It disappears from your list. A new message brings it back.'),
            actions: [
              TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
              FilledButton(
                style: FilledButton.styleFrom(backgroundColor: Theme.of(context).colorScheme.error),
                onPressed: () => Navigator.pop(context, true),
                child: Text(chat.isGroup ? 'Leave' : 'Delete'),
              ),
            ],
          ),
        );
        if (ok != true) return;
        await (chat.isGroup ? ChatRepository.leaveGroup(chat.chatId) : ChatRepository.hideChat(chat.chatId));
        if (mounted) setState(() => _chats = _chats.where((c) => c.chatId != chat.chatId).toList());
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(chatActionError(e))));
    }
  }

  // --- Tabs: Chats / Groups / Calls (same sections as the web sidebar) ---------

  int _tab = 0;
  bool _callsVisited = false;
  final _groupFilter = TextEditingController();

  static const _titles = ['Chats', 'Groups', 'Calls'];

  int _unreadOf(Iterable<ChatSummary> chats) =>
      chats.fold(0, (sum, c) => sum + (c.isMuted || c.chatId == _openChatId ? 0 : c.unreadCount));

  Future<void> _confirmSignOut() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Sign out?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Sign out')),
        ],
      ),
    );
    if (ok == true) await supabase.auth.signOut();
  }

  Widget _badgeIcon(IconData icon, int count) => Badge(
        isLabelVisible: count > 0,
        label: Text(count > 99 ? '99+' : '$count'),
        child: Icon(icon),
      );

  @override
  Widget build(BuildContext context) {
    final me = _me;
    final scheme = Theme.of(context).colorScheme;
    final direct = _chats.where((c) => !c.isGroup).toList();
    final allGroups = _chats.where((c) => c.isGroup).toList();
    final query = _groupFilter.text.trim().toLowerCase();
    final groups = query.isEmpty ? allGroups : allGroups.where((c) => c.name.toLowerCase().contains(query)).toList();

    return Scaffold(
      appBar: AppBar(
        title: Text(_titles[_tab]),
        actions: [
          IconButton(tooltip: 'Gallery', onPressed: _openGallery, icon: const Icon(Icons.photo_library_outlined)),
          IconButton(
            tooltip: 'Settings',
            onPressed: _openSettings,
            icon: Avatar(name: me.name, imageUrl: me.avatarImageUrl, size: 32),
          ),
          const SizedBox(width: 8),
        ],
      ),
      floatingActionButton: _tab == 1
          ? FloatingActionButton(
              tooltip: 'New group',
              onPressed: _newGroup,
              child: const Icon(Icons.group_add_outlined),
            )
          : null,
      body: IndexedStack(
        index: _tab,
        children: [
          Column(
            children: [
              _UserSearch(meId: me.id, onStartChat: _startChat),
              Expanded(
                child: _buildList(context, direct, 'No conversations yet.\nSearch for an @username to start one.'),
              ),
            ],
          ),
          Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                child: TextField(
                  controller: _groupFilter,
                  onChanged: (_) => setState(() {}),
                  textInputAction: TextInputAction.search,
                  decoration: InputDecoration(
                    hintText: 'Search groups',
                    prefixIcon: const Icon(Icons.search),
                    isDense: true,
                    filled: true,
                    fillColor: scheme.surfaceContainerHighest.withValues(alpha: 0.5),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                  ),
                ),
              ),
              Expanded(
                child: _buildList(
                  context,
                  groups,
                  query.isNotEmpty ? 'No groups match your search.' : 'No groups yet.\nTap + to create one.',
                ),
              ),
            ],
          ),
          // Built on first visit, so the call history isn't fetched at launch.
          if (_callsVisited)
            CallsTab(
              meId: me.id,
              chats: _chats,
              onOpenChat: (chatId) => _openChat(chatId, summary: _chats.where((c) => c.chatId == chatId).firstOrNull),
            )
          else
            const SizedBox.shrink(),
        ],
      ),
      bottomNavigationBar: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // The footer below handles the bottom safe area. `context` is from
          // outside the Scaffold, so the status-bar inset must be removed here
          // too, or NavigationBar's SafeArea pads the top of the bar with it.
          MediaQuery.removePadding(
            context: context,
            removeTop: true,
            removeBottom: true,
            child: NavigationBar(
              // Default is 80; keep it tight so the bar plus footer don't eat the screen.
              height: 60,
              labelPadding: const EdgeInsets.only(top: 2),
              selectedIndex: _tab,
              onDestinationSelected: (i) => setState(() {
                _tab = i;
                if (i == 2) _callsVisited = true;
              }),
              destinations: [
                NavigationDestination(
                  icon: _badgeIcon(Icons.chat_bubble_outline, _unreadOf(direct)),
                  selectedIcon: _badgeIcon(Icons.chat_bubble, _unreadOf(direct)),
                  label: 'Chats',
                ),
                NavigationDestination(
                  icon: _badgeIcon(Icons.group_outlined, _unreadOf(allGroups)),
                  selectedIcon: _badgeIcon(Icons.group, _unreadOf(allGroups)),
                  label: 'Groups',
                ),
                const NavigationDestination(icon: Icon(Icons.call_outlined), selectedIcon: Icon(Icons.call), label: 'Calls'),
              ],
            ),
          ),
          // Footer: the very last thing on the screen, under the tab bar.
          DecoratedBox(
            decoration: BoxDecoration(border: Border(top: BorderSide(color: scheme.outlineVariant))),
            child: SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Row(
                  children: [
                    const Expanded(child: _PoweredBy()),
                    TextButton.icon(
                      onPressed: _confirmSignOut,
                      style: TextButton.styleFrom(
                        foregroundColor: scheme.onSurfaceVariant,
                        visualDensity: VisualDensity.compact,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        minimumSize: const Size(0, 32),
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500),
                      ),
                      icon: const Icon(Icons.logout, size: 16),
                      label: const Text('Sign out'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildList(BuildContext context, List<ChatSummary> chats, String empty) {
    if (_loading) return const Center(child: CircularProgressIndicator());

    if (_loadError != null && chats.isEmpty) {
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
      child: chats.isEmpty
          ? ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(32, 64, 32, 0),
                  child: Text(empty, textAlign: TextAlign.center),
                ),
              ],
            )
          : ListView.separated(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.only(bottom: 88),
              itemCount: chats.length,
              separatorBuilder: (_, _) => const Divider(height: 1, indent: 72),
              itemBuilder: (context, i) => _ChatTile(
                chat: chats[i],
                meId: _me.id,
                onTap: () => _openChat(chats[i].chatId, summary: chats[i]),
                onLongPress: () => _chatActions(chats[i]),
              ),
            ),
    );
  }
}

/// "Powered by Devcipator", linking to the company site (as on the web).
class _PoweredBy extends StatelessWidget {
  const _PoweredBy();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Align(
      alignment: Alignment.centerLeft,
      child: InkWell(
        borderRadius: BorderRadius.circular(6),
        onTap: () => launchUrl(Uri.parse('https://www.devcipator.com/'), mode: LaunchMode.externalApplication),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
          child: Text.rich(
            TextSpan(children: [
              const TextSpan(text: 'Powered by '),
              TextSpan(
                text: 'Devcipator',
                style: TextStyle(fontWeight: FontWeight.w600, color: scheme.onSurface.withValues(alpha: 0.8)),
              ),
            ]),
            style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
          ),
        ),
      ),
    );
  }
}

class _ChatTile extends StatelessWidget {
  const _ChatTile({required this.chat, required this.meId, required this.onTap, required this.onLongPress});

  final ChatSummary chat;
  final String meId;
  final VoidCallback onTap;
  final VoidCallback onLongPress;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final last = chat.lastMessage;
    final unread = chat.unreadCount > 0;
    String snippet;
    if (last == null) {
      snippet = chat.isGroup ? '${chat.memberCount} members' : 'No messages yet';
    } else {
      final body = messageSnippet(last.type, last.content, last.durationSeconds);
      final prefix = last.type == 'system'
          ? ''
          : last.senderId == meId
              ? 'You: '
              : chat.isGroup && last.senderName != null
                  ? '${last.senderName}: '
                  : '';
      snippet = '$prefix$body';
    }

    return ListTile(
      onTap: onTap,
      onLongPress: onLongPress,
      leading: Avatar(
        name: chat.name,
        imageUrl: chat.isGroup ? null : chat.other?.avatarImageUrl,
        group: chat.isGroup,
        size: 44,
      ),
      title: Row(
        children: [
          Expanded(
            child: Text(
              chat.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: unread ? const TextStyle(fontWeight: FontWeight.w700) : null,
            ),
          ),
          if (chat.isMuted)
            Padding(
              padding: const EdgeInsets.only(left: 4),
              child: Icon(Icons.notifications_off, size: 14, color: scheme.onSurfaceVariant),
            ),
          const SizedBox(width: 8),
          Text(
            formatListTime(context, chat.lastActivity),
            style: Theme.of(context).textTheme.labelSmall?.copyWith(color: unread ? scheme.primary : scheme.onSurfaceVariant),
          ),
        ],
      ),
      subtitle: Row(
        children: [
          Expanded(
            child: Text(
              snippet,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: unread ? TextStyle(color: scheme.onSurface, fontWeight: FontWeight.w500) : null,
            ),
          ),
          if (unread)
            Container(
              margin: const EdgeInsets.only(left: 8),
              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
              constraints: const BoxConstraints(minWidth: 22),
              decoration: BoxDecoration(
                color: chat.isMuted ? scheme.onSurfaceVariant : scheme.primary,
                borderRadius: BorderRadius.circular(11),
              ),
              child: Text(
                chat.unreadCount > 99 ? '99+' : '${chat.unreadCount}',
                textAlign: TextAlign.center,
                style: TextStyle(color: scheme.onPrimary, fontSize: 12, fontWeight: FontWeight.w600),
              ),
            ),
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
          leading: Avatar(name: profile.name, imageUrl: profile.avatarImageUrl),
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
