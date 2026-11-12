import 'dart:async';

import 'package:flutter/material.dart';

import '../core/config.dart';
import '../data/chat_repository.dart';
import '../models/chat_details.dart';
import '../models/profile.dart';
import '../widgets/avatar.dart';
import '../widgets/member_picker.dart';

/// Group members and admin controls.
///
/// Pops with `'removed'` when I left / deleted the group, or `'open:<chatId>'`
/// to open a direct chat with a member.
class GroupInfoScreen extends StatefulWidget {
  const GroupInfoScreen({super.key, required this.chatId, required this.me});

  final String chatId;
  final Profile me;

  @override
  State<GroupInfoScreen> createState() => _GroupInfoScreenState();
}

class _GroupInfoScreenState extends State<GroupInfoScreen> {
  ChatDetails? _details;
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final details = await ChatRepository.details(widget.chatId);
      if (!mounted) return;
      if (details == null) {
        Navigator.of(context).pop('removed');
        return;
      }
      setState(() {
        _details = details;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() => _error = chatActionError(e));
    }
  }

  void _snack(String text) => ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(text)));

  Future<void> _run(Future<void> Function() action, {String? done, bool leave = false}) async {
    setState(() => _busy = true);
    try {
      await action();
      if (!mounted) return;
      if (done != null) _snack(done);
      if (leave) {
        Navigator.of(context).pop('removed');
        return;
      }
      await _load();
    } catch (e) {
      if (mounted) _snack(chatActionError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<bool> _confirm(String title, String body, String action) async =>
      await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(title),
          content: Text(body),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: Theme.of(context).colorScheme.error),
              onPressed: () => Navigator.pop(context, true),
              child: Text(action),
            ),
          ],
        ),
      ) ==
      true;

  Future<void> _rename() async {
    final controller = TextEditingController(text: _details?.title);
    final title = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Rename group'),
        content: TextField(controller: controller, autofocus: true, maxLength: AppConfig.groupTitleMax),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, controller.text.trim()), child: const Text('Save')),
        ],
      ),
    );
    controller.dispose();
    if (title == null || title.isEmpty || title == _details?.title) return;
    await _run(() => ChatRepository.renameGroup(widget.chatId, title), done: 'Group renamed');
  }

  Future<void> _addMembers() async {
    final existing = {for (final m in _details?.members ?? const <ChatMember>[]) m.id};
    final picked = await showModalBottomSheet<List<Profile>>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _AddMembersSheet(meId: widget.me.id, excludeIds: existing),
    );
    if (picked == null || picked.isEmpty) return;
    await _run(
      () => ChatRepository.addMembers(widget.chatId, [for (final p in picked) p.id]),
      done: 'Added ${picked.length} ${picked.length == 1 ? 'person' : 'people'}',
    );
  }

  Future<void> _memberActions(ChatMember member) async {
    final details = _details!;
    final isMe = member.id == widget.me.id;
    final choice = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Wrap(
          children: [
            ListTile(
              leading: Avatar(name: member.profile.name, imageUrl: member.profile.avatarImageUrl),
              title: Text(member.profile.name),
              subtitle: member.profile.hasUsername ? Text('@${member.profile.username}') : null,
            ),
            const Divider(height: 1),
            if (!isMe)
              ListTile(leading: const Icon(Icons.chat_bubble_outline), title: const Text('Message'), onTap: () => Navigator.pop(context, 'dm')),
            if (details.isAdmin && !isMe)
              ListTile(
                leading: Icon(member.isAdmin ? Icons.remove_moderator_outlined : Icons.add_moderator_outlined),
                title: Text(member.isAdmin ? 'Remove as admin' : 'Make admin'),
                onTap: () => Navigator.pop(context, 'role'),
              ),
            if (details.isAdmin && !isMe)
              ListTile(
                leading: Icon(Icons.person_remove_outlined, color: Theme.of(context).colorScheme.error),
                title: Text('Remove from group', style: TextStyle(color: Theme.of(context).colorScheme.error)),
                onTap: () => Navigator.pop(context, 'remove'),
              ),
          ],
        ),
      ),
    );
    if (!mounted || choice == null) return;
    switch (choice) {
      case 'dm':
        setState(() => _busy = true);
        try {
          final chatId = await ChatRepository.createDirectChat(member.id);
          if (mounted) Navigator.of(context).pop('open:$chatId');
        } catch (e) {
          if (mounted) {
            setState(() => _busy = false);
            _snack(chatActionError(e));
          }
        }
      case 'role':
        await _run(() => ChatRepository.setRole(widget.chatId, member.id, admin: !member.isAdmin));
      case 'remove':
        if (await _confirm('Remove ${member.profile.name}?', 'They will no longer see new messages.', 'Remove')) {
          await _run(() => ChatRepository.removeMember(widget.chatId, member.id));
        }
    }
  }

  @override
  Widget build(BuildContext context) {
    final details = _details;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Group info'),
        bottom: _busy ? const PreferredSize(preferredSize: Size.fromHeight(2), child: LinearProgressIndicator()) : null,
      ),
      body: details == null
          ? Center(child: _error != null ? Text(_error!) : const CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                children: [
                  const SizedBox(height: 24),
                  Center(child: Avatar(name: details.name(widget.me.id), group: true, size: 88)),
                  const SizedBox(height: 12),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Flexible(
                        child: Text(
                          details.name(widget.me.id),
                          textAlign: TextAlign.center,
                          style: Theme.of(context).textTheme.headlineSmall,
                        ),
                      ),
                      if (details.isAdmin)
                        IconButton(tooltip: 'Rename', onPressed: _busy ? null : _rename, icon: const Icon(Icons.edit_outlined)),
                    ],
                  ),
                  Text('${details.members.length} members', textAlign: TextAlign.center),
                  const SizedBox(height: 16),
                  if (details.isAdmin)
                    ListTile(
                      leading: const Icon(Icons.person_add_alt_1_outlined),
                      title: const Text('Add members'),
                      onTap: _busy ? null : _addMembers,
                    ),
                  for (final m in details.members)
                    ListTile(
                      onTap: _busy ? null : () => _memberActions(m),
                      leading: Avatar(name: m.profile.name, imageUrl: m.profile.avatarImageUrl),
                      title: Text(m.id == widget.me.id ? '${m.profile.name} (you)' : m.profile.name),
                      subtitle: m.profile.hasUsername ? Text('@${m.profile.username}') : null,
                      trailing: m.isAdmin ? const Chip(label: Text('Admin'), visualDensity: VisualDensity.compact) : null,
                    ),
                  const Divider(),
                  ListTile(
                    leading: Icon(Icons.logout, color: Theme.of(context).colorScheme.error),
                    title: Text('Leave group', style: TextStyle(color: Theme.of(context).colorScheme.error)),
                    onTap: _busy
                        ? null
                        : () async {
                            if (await _confirm('Leave group?', "You won't get new messages from this group.", 'Leave')) {
                              await _run(() => ChatRepository.leaveGroup(widget.chatId), leave: true);
                            }
                          },
                  ),
                  if (details.isAdmin)
                    ListTile(
                      leading: Icon(Icons.delete_forever_outlined, color: Theme.of(context).colorScheme.error),
                      title: Text('Delete group', style: TextStyle(color: Theme.of(context).colorScheme.error)),
                      onTap: _busy
                          ? null
                          : () async {
                              if (await _confirm('Delete group?', 'The group and its messages are deleted for everyone.', 'Delete')) {
                                await _run(() => ChatRepository.deleteGroup(widget.chatId), leave: true);
                              }
                            },
                    ),
                  const SizedBox(height: 24),
                ],
              ),
            ),
    );
  }
}

class _AddMembersSheet extends StatefulWidget {
  const _AddMembersSheet({required this.meId, required this.excludeIds});

  final String meId;
  final Set<String> excludeIds;

  @override
  State<_AddMembersSheet> createState() => _AddMembersSheetState();
}

class _AddMembersSheetState extends State<_AddMembersSheet> {
  List<Profile> _selected = const [];

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + MediaQuery.viewInsetsOf(context).bottom),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Add members', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            MemberPicker(
              meId: widget.meId,
              excludeIds: widget.excludeIds,
              selected: _selected,
              onChanged: (s) => setState(() => _selected = s),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _selected.isEmpty ? null : () => Navigator.pop(context, _selected),
              child: const Text('Add'),
            ),
          ],
        ),
      );
}
