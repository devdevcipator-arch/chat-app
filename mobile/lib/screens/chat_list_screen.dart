import 'dart:async';

import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../core/errors.dart';
import '../core/responsive.dart';
import '../core/supabase.dart';
import '../core/time_format.dart';
import '../core/username.dart';
import '../data/chat_repository.dart';
import '../data/local_cache.dart';
import '../data/profile_repository.dart';
import '../models/chat_message.dart';
import '../models/chat_summary.dart';
import '../models/profile.dart';
import '../services/call_controller.dart';
import '../services/missed_calls.dart';
import '../services/network_status.dart';
import '../widgets/avatar.dart';
import '../widgets/offline_banner.dart';
import 'calls_tab.dart';
import 'chat_screen.dart';
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

  // Hydrated from the local cache on the first frame; every change is
  // written back (debounced) so the next launch, or an offline one, opens
  // instantly with the latest list.
  late final List<ChatSummary>? _cached = LocalCache.chats(widget.me.id);
  late List<ChatSummary> _chatList = _cached ?? const [];
  List<ChatSummary> get _chats => _chatList;
  set _chats(List<ChatSummary> chats) {
    _chatList = chats;
    _persistDebounce?.cancel();
    _persistDebounce = Timer(const Duration(milliseconds: 500), () => LocalCache.saveChats(widget.me.id, _chatList));
  }

  /// Only a first launch with nothing cached shows a spinner.
  late bool _loading = _cached == null;
  String? _loadError;
  RealtimeChannel? _channel;
  bool _channelLive = false;
  Timer? _refreshDebounce;
  Timer? _persistDebounce;
  StreamSubscription<void>? _reconnectSub;

  /// The chat currently open on top of the list (its unread count stays 0).
  String? _openChatId;

  @override
  void initState() {
    super.initState();
    _refresh();
    _subscribe();
    unawaited(CallController.instance.attach(widget.me.id));
    MissedCalls.instance
      ..attach(widget.me.id)
      ..addListener(_onMissedCalls);
    _reconnectSub = NetworkStatus.instance.reconnects.listen((_) => _onReconnect());
  }

  /// Calls badge: redraw, and keep it at zero while the Calls tab is in view.
  void _onMissedCalls() {
    if (!mounted) return;
    if (_tab == 2 && MissedCalls.instance.value > 0 && (ModalRoute.of(context)?.isCurrent ?? true)) {
      MissedCalls.instance.markSeen();
      return;
    }
    setState(() {});
  }

  /// Back online: catch up, and re-join Realtime if the channel gave up.
  void _onReconnect() {
    if (!mounted) return;
    unawaited(_refresh());
    final channel = _channel;
    if (channel == null || _channelLive) return;
    _channel = null;
    unawaited(supabase.removeChannel(channel));
    _subscribe();
  }

  @override
  void didUpdateWidget(ChatListScreen old) {
    super.didUpdateWidget(old);
    if (old.me != widget.me) _me = widget.me;
  }

  @override
  void dispose() {
    _refreshDebounce?.cancel();
    _reconnectSub?.cancel();
    MissedCalls.instance.removeListener(_onMissedCalls);
    if (_persistDebounce?.isActive ?? false) {
      _persistDebounce!.cancel();
      unawaited(LocalCache.saveChats(widget.me.id, _chatList));
    }
    _groupFilter.dispose();
    _chatSearch.dispose();
    final channel = _channel;
    if (channel != null) unawaited(supabase.removeChannel(channel));
    super.dispose();
  }

  Future<void> _refresh() async {
    try {
      final chats = await ChatRepository.listMyChats();
      NetworkStatus.instance.reportSuccess();
      if (!mounted) return;
      setState(() {
        _chats = chats;
        _loading = false;
        _loadError = null;
      });
    } catch (e) {
      // Cached chats stay on screen; the offline banner explains why.
      NetworkStatus.instance.reportFailure(e);
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
          _channelLive = status == RealtimeSubscribeStatus.subscribed;
          if (_channelLive) {
            NetworkStatus.instance.reportSuccess();
            _refreshSoon();
          }
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
      unawaited(LocalCache.removeMessages(widget.me.id, chatId));
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

  /// Joins (or re-opens) a group found by search and opens it right away;
  /// the list row is added optimistically, the next refresh fills it in.
  /// Returns an error message, or null on success.
  Future<String?> _joinGroup(GroupSearchResult group) async {
    try {
      final chatId = await ChatRepository.joinGroup(group.id);
      if (!mounted) return null;
      final summary = _chats.where((c) => c.chatId == chatId).firstOrNull ??
          ChatSummary(
            chatId: chatId,
            type: 'group',
            createdAt: DateTime.now(),
            other: null,
            lastMessage: null,
            title: group.title,
            avatarUrl: group.avatarUrl,
            memberCount: group.isMember ? group.memberCount : group.memberCount + 1,
          );
      setState(() {
        _chats = [summary, ..._chats.where((c) => c.chatId != chatId)];
        _chatSearch.clear();
        _groupFilter.clear();
      });
      unawaited(_openChat(chatId, summary: summary));
      return null;
    } catch (e) {
      return isOfflineError(e) ? "You're offline. Connect to join groups." : chatActionError(e);
    }
  }

  Widget _discoverGroups(String query) => _DiscoverGroups(
        query: query,
        knownChatIds: {for (final c in _chats) c.chatId},
        onJoin: _joinGroup,
      );

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

  /// The Chats search box: filters direct chats and groups (works offline,
  /// on the cached list) and looks up an exact @username.
  final _chatSearch = TextEditingController();

  Widget _searchField(TextEditingController controller, String hint) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: EdgeInsets.fromLTRB(context.compact(16), context.compact(8), context.compact(16), context.compact(14)),
      child: TextField(
        controller: controller,
        onChanged: (_) => setState(() {}),
        autocorrect: false,
        enableSuggestions: false,
        textInputAction: TextInputAction.search,
        decoration: InputDecoration(
          hintText: hint,
          prefixIcon: const Icon(Icons.search),
          isDense: true,
          filled: true,
          fillColor: scheme.surfaceContainerHighest.withValues(alpha: 0.5),
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
          suffixIcon: controller.text.isEmpty
              ? null
              : IconButton(
                  tooltip: 'Clear',
                  icon: const Icon(Icons.close),
                  onPressed: () => setState(controller.clear),
                ),
        ),
      ),
    );
  }

  /// Search results. My matching groups first (filtered locally, instantly),
  /// then direct chats, then groups by others from the server ("Discover"),
  /// then "Find People" for an @username. [groupsOnly] is the Groups tab.
  Widget _buildSearchResults(List<ChatSummary> matches, String query, {bool groupsOnly = false}) {
    final groups = matches.where((c) => c.isGroup).toList();
    final directs = groupsOnly ? const <ChatSummary>[] : matches.where((c) => !c.isGroup).toList();
    final username = groupsOnly ? null : usernameQuery(query);
    Widget tile(ChatSummary c) => _ChatTile(
          key: ValueKey(c.chatId),
          chat: c,
          meId: _me.id,
          onTap: () => _openChat(c.chatId, summary: c),
          onLongPress: () => _chatActions(c),
        );
    return ListView(
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      padding: const EdgeInsets.only(bottom: 88),
      children: [
        if (groups.isNotEmpty) ...[_SectionHeader('Your Groups', groups.length), ...groups.map(tile)],
        if (directs.isNotEmpty) ...[_SectionHeader('Direct Chats', directs.length), ...directs.map(tile)],
        if (groups.isEmpty && directs.isEmpty && username == null)
          Padding(
            padding: const EdgeInsets.fromLTRB(32, 32, 32, 8),
            child: Text(groupsOnly ? 'None of your groups match.' : 'No matching chats or groups.',
                textAlign: TextAlign.center),
          ),
        _discoverGroups(query),
        if (username != null) ...[
          const _SectionHeader('Find People (@username)'),
          _PeopleLookup(
            username: username,
            meId: _me.id,
            onStartChat: _startChat,
            onStarted: () => setState(_chatSearch.clear),
          ),
        ],
      ],
    );
  }

  static const _titles = ['Chats', 'Groups', 'Calls'];

  int _unreadOf(Iterable<ChatSummary> chats) =>
      chats.fold(0, (sum, c) => sum + (c.isMuted || c.chatId == _openChatId ? 0 : c.unreadCount));

  Widget _badgeIcon(IconData icon, int count) => Badge(
        isLabelVisible: count > 0,
        label: Text(count > 99 ? '99+' : '$count'),
        child: Icon(icon),
      );

  @override
  Widget build(BuildContext context) {
    final me = _me;
    // Chats: every conversation (direct + groups), newest activity first.
    // Groups: group chats only.
    final all = [..._chats]..sort((a, b) => b.lastActivity.compareTo(a.lastActivity));
    final allGroups = all.where((c) => c.isGroup).toList();
    final chatQuery = _chatSearch.text.trim();
    final chats = chatQuery.isEmpty ? all : all.where((c) => c.matches(chatQuery)).toList();
    final query = _groupFilter.text.trim();
    final groups = query.isEmpty ? allGroups : allGroups.where((c) => c.matches(query)).toList();
    final missedCalls = MissedCalls.instance.value;

    return Scaffold(
      appBar: AppBar(
        title: Text(_titles[_tab]),
        actions: [
          IconButton(
            tooltip: 'Settings',
            onPressed: _openSettings,
            icon: Avatar(name: me.name, imageUrl: me.avatarImageUrl, size: context.compact(32)),
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
      body: Column(
        children: [
          const OfflineBanner(message: 'Offline — showing cached chats'),
          Expanded(
            child: IndexedStack(
              index: _tab,
              children: [
                Column(
                  children: [
                    // Always visible: no extra tap to reveal search.
                    _searchField(_chatSearch, 'Search chats & groups…'),
                    Expanded(
                      child: chatQuery.isEmpty
                          ? _buildList(context, all, 'No conversations yet.\nSearch for an @username to start one.')
                          : _buildSearchResults(chats, chatQuery),
                    ),
                  ],
                ),
                Column(
                  children: [
                    _searchField(_groupFilter, 'Search groups…'),
                    Expanded(
                      child: query.isEmpty
                          ? _buildList(context, groups, 'No groups yet.\nTap + to create one, or search to find one.')
                          : _buildSearchResults(groups, query, groupsOnly: true),
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
          ),
        ],
      ),
      // `context` is from outside the Scaffold, so the status-bar inset must be
      // removed here, or NavigationBar's SafeArea pads the top of the bar with
      // it. The bottom inset stays: NavigationBar keeps clear of the home bar.
      bottomNavigationBar: MediaQuery.removePadding(
        context: context,
        removeTop: true,
        child: NavigationBar(
          // Default is 80; keep it tight so the bar doesn't eat the screen.
          height: context.compact(60),
          labelPadding: const EdgeInsets.only(top: 2),
          selectedIndex: _tab,
          onDestinationSelected: (i) => setState(() {
            _tab = i;
            if (i == 2) {
              _callsVisited = true;
              MissedCalls.instance.markSeen(); // opening Calls clears its badge
            }
          }),
          destinations: [
            NavigationDestination(
              icon: _badgeIcon(Icons.chat_bubble_outline, _unreadOf(all)),
              selectedIcon: _badgeIcon(Icons.chat_bubble, _unreadOf(all)),
              label: 'Chats',
            ),
            NavigationDestination(
              icon: _badgeIcon(Icons.group_outlined, _unreadOf(allGroups)),
              selectedIcon: _badgeIcon(Icons.group, _unreadOf(allGroups)),
              label: 'Groups',
            ),
            NavigationDestination(
              icon: _badgeIcon(Icons.call_outlined, missedCalls),
              selectedIcon: _badgeIcon(Icons.call, missedCalls),
              label: 'Calls',
            ),
          ],
        ),
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
                key: ValueKey(chats[i].chatId),
                chat: chats[i],
                meId: _me.id,
                onTap: () => _openChat(chats[i].chatId, summary: chats[i]),
                onLongPress: () => _chatActions(chats[i]),
              ),
            ),
    );
  }
}

class _ChatTile extends StatelessWidget {
  const _ChatTile({super.key, required this.chat, required this.meId, required this.onTap, required this.onLongPress});

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
      minVerticalPadding: context.compact(12),
      leading: Avatar(
        name: chat.name,
        imageUrl: chat.isGroup ? null : chat.other?.avatarImageUrl,
        group: chat.isGroup,
        size: context.compact(48),
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
// "Find People": exact @username lookup in the Chats search results
// ---------------------------------------------------------------------------

/// The exact @username a search query holds, or null if it can't be one
/// ("Book Club" has a space; "@Alice" is fine and becomes "alice").
String? usernameQuery(String query) {
  final candidate = query.trim().toLowerCase().replaceFirst(RegExp(r'^@'), '');
  final username = normalizeUsername(candidate);
  return username == candidate && isValidUsername(username) ? username : null;
}

sealed class _SearchState {
  const _SearchState();
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
  const _NotFound();
}

class _Failed extends _SearchState {
  const _Failed(this.message);
  final String message;
}

/// Looks up [username] (debounced) so a new chat can be started with them.
/// Existing chats and groups are listed above it, so it never hides them.
class _PeopleLookup extends StatefulWidget {
  const _PeopleLookup({
    required this.username,
    required this.meId,
    required this.onStartChat,
    required this.onStarted,
  });

  final String username;
  final String meId;

  /// Returns an error message, or null on success.
  final Future<String?> Function(Profile other) onStartChat;

  /// After a chat was started (clears the search).
  final VoidCallback onStarted;

  @override
  State<_PeopleLookup> createState() => _PeopleLookupState();
}

class _PeopleLookupState extends State<_PeopleLookup> {
  _SearchState _state = const _Searching();
  bool _starting = false;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _schedule();
  }

  @override
  void didUpdateWidget(_PeopleLookup old) {
    super.didUpdateWidget(old);
    if (old.username != widget.username) {
      _state = const _Searching();
      _schedule();
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  void _schedule() {
    _timer?.cancel();
    final username = widget.username;
    _timer = Timer(const Duration(milliseconds: 350), () => _lookup(username));
  }

  Future<void> _lookup(String username) async {
    _SearchState next;
    try {
      final profile = await ProfileRepository.findByUsername(username);
      next = profile == null
          ? const _NotFound()
          : profile.id == widget.meId
              ? const _Self()
              : _Found(profile);
    } catch (e) {
      next = _Failed(isOfflineError(e) ? "You're offline. Connect to find new people." : 'Search failed. Try again.');
    }
    if (!mounted || widget.username != username) return;
    setState(() => _state = next);
  }

  Future<void> _start(Profile profile) async {
    setState(() => _starting = true);
    final error = await widget.onStartChat(profile);
    if (!mounted) return;
    setState(() {
      _starting = false;
      if (error != null) _state = _Failed(error);
    });
    if (error == null) widget.onStarted();
  }

  @override
  Widget build(BuildContext context) {
    final muted = TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant);
    final username = widget.username;
    final Widget body = switch (_state) {
      _Searching() => ListTile(
          dense: true,
          leading: const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2)),
          title: Text('Looking up @$username…'),
        ),
      _NotFound() => ListTile(dense: true, title: Text('No one goes by @$username.', style: muted)),
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
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12),
      child: Semantics(liveRegion: true, child: body),
    );
  }
}

// ---------------------------------------------------------------------------
// "Discover Groups": server-side group search (groups created by anyone)
// ---------------------------------------------------------------------------

/// Searches every group on the platform by title (debounced) and lists the
/// ones not already shown under "Your Groups", with Join (or Open, for a
/// group I'm in that isn't in my loaded list, e.g. hidden).
class _DiscoverGroups extends StatefulWidget {
  const _DiscoverGroups({required this.query, required this.knownChatIds, required this.onJoin});

  final String query;

  /// Chats already listed locally; they're left out of the results.
  final Set<String> knownChatIds;

  /// Returns an error message, or null on success.
  final Future<String?> Function(GroupSearchResult group) onJoin;

  @override
  State<_DiscoverGroups> createState() => _DiscoverGroupsState();
}

class _DiscoverGroupsState extends State<_DiscoverGroups> {
  static const _debounce = Duration(milliseconds: 250);
  static const _minLength = 2;

  Timer? _timer;

  /// The query [_results] answer (null: nothing fetched yet).
  String? _resultsFor;
  List<GroupSearchResult> _results = const [];
  String? _error;
  String? _joiningId;

  String get _query => widget.query.trim().replaceFirst(RegExp(r'^@'), '');

  @override
  void initState() {
    super.initState();
    _schedule();
  }

  @override
  void didUpdateWidget(_DiscoverGroups old) {
    super.didUpdateWidget(old);
    if (old.query != widget.query) _schedule();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  void _schedule() {
    _timer?.cancel();
    final query = _query;
    if (query.length < _minLength) return;
    _timer = Timer(_debounce, () => _search(query));
  }

  Future<void> _search(String query) async {
    List<GroupSearchResult>? results;
    String? error;
    try {
      results = await ChatRepository.searchGroups(query);
    } catch (e) {
      error = isOfflineError(e) ? "You're offline. Connect to discover groups." : 'Group search failed. Try again.';
    }
    if (!mounted || _query != query) return; // a newer query is on its way
    setState(() {
      _resultsFor = query;
      _results = results ?? const [];
      _error = error;
    });
  }

  Future<void> _join(GroupSearchResult group) async {
    setState(() {
      _joiningId = group.id;
      _error = null;
    });
    final error = await widget.onJoin(group);
    if (!mounted) return;
    setState(() {
      _joiningId = null;
      _error = error;
    });
  }

  @override
  Widget build(BuildContext context) {
    final query = _query;
    if (query.length < _minLength) return const SizedBox.shrink();
    final scheme = Theme.of(context).colorScheme;
    final muted = TextStyle(color: scheme.onSurfaceVariant);
    // Stale results stay up while the next query loads, so nothing flickers.
    final loading = _resultsFor != query;
    final shown = _results.where((g) => !widget.knownChatIds.contains(g.id)).toList();

    final children = <Widget>[
      _SectionHeader('Discover Groups', shown.isEmpty ? null : shown.length),
      if (loading && shown.isEmpty)
        ListTile(
          dense: true,
          leading: const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2)),
          title: Text('Searching groups for “$query”…'),
        )
      else if (_error != null && shown.isEmpty)
        ListTile(dense: true, title: Text(_error!, style: TextStyle(color: scheme.error)))
      else if (shown.isEmpty)
        ListTile(dense: true, title: Text('No other groups match “$query”.', style: muted)),
      for (final group in shown)
        ListTile(
          key: ValueKey('discover:${group.id}'),
          onTap: _joiningId == null ? () => _join(group) : null,
          leading: Avatar(name: group.title, group: true, size: context.compact(48)),
          title: Text(group.title, maxLines: 1, overflow: TextOverflow.ellipsis),
          subtitle: Text(group.memberCount == 1 ? '1 member' : '${group.memberCount} members'),
          trailing: _joiningId == group.id
              ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
              : group.isMember
                  ? OutlinedButton(onPressed: _joiningId == null ? () => _join(group) : null, child: const Text('Open'))
                  : FilledButton(onPressed: _joiningId == null ? () => _join(group) : null, child: const Text('Join')),
        ),
      if (_error != null && shown.isNotEmpty)
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Text(_error!, style: TextStyle(color: scheme.error)),
        ),
    ];
    return Semantics(liveRegion: true, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children));
  }
}

/// Small section header in search results ("GROUPS · 2").
class _SectionHeader extends StatelessWidget {
  const _SectionHeader(this.title, [this.count]);

  final String title;
  final int? count;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: Text(
        count == null ? title.toUpperCase() : '${title.toUpperCase()} · $count',
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: scheme.onSurfaceVariant,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.6,
            ),
      ),
    );
  }
}
