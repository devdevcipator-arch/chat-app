import 'dart:async';

import 'package:flutter/material.dart';

import '../core/username.dart';
import '../data/profile_repository.dart';
import '../models/profile.dart';
import 'avatar.dart';

/// Exact @username lookup that adds people to a selection (groups).
class MemberPicker extends StatefulWidget {
  const MemberPicker({super.key, required this.meId, required this.selected, required this.onChanged, this.excludeIds = const {}});

  final String meId;
  final List<Profile> selected;
  final ValueChanged<List<Profile>> onChanged;

  /// Already in the group.
  final Set<String> excludeIds;

  @override
  State<MemberPicker> createState() => _MemberPickerState();
}

class _MemberPickerState extends State<MemberPicker> {
  final _controller = TextEditingController();
  Timer? _timer;
  String _latest = '';
  String? _message;
  Profile? _found;
  bool _searching = false;

  @override
  void dispose() {
    _timer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _onChanged(String username) {
    _timer?.cancel();
    _latest = username;
    setState(() {
      _found = null;
      _message = null;
      _searching = isValidUsername(username);
    });
    if (!_searching) return;
    _timer = Timer(const Duration(milliseconds: 350), () async {
      String? message;
      Profile? found;
      try {
        final p = await ProfileRepository.findByUsername(username);
        if (p == null) {
          message = 'No one goes by @$username.';
        } else if (p.id == widget.meId) {
          message = "That's you.";
        } else if (widget.excludeIds.contains(p.id)) {
          message = '${p.name} is already in the group.';
        } else {
          found = p;
        }
      } catch (_) {
        message = 'Search failed. Try again.';
      }
      if (!mounted || _latest != username) return;
      setState(() {
        _searching = false;
        _found = found;
        _message = message;
      });
    });
  }

  void _add(Profile p) {
    if (!widget.selected.any((s) => s.id == p.id)) widget.onChanged([...widget.selected, p]);
    _controller.clear();
    _onChanged('');
  }

  @override
  Widget build(BuildContext context) {
    final found = _found;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: _controller,
          autocorrect: false,
          enableSuggestions: false,
          inputFormatters: [UsernameInputFormatter()],
          onChanged: _onChanged,
          decoration: const InputDecoration(
            labelText: 'Add people by exact username',
            prefixText: '@',
            prefixIcon: Icon(Icons.person_add_alt),
          ),
        ),
        if (_searching) const LinearProgressIndicator(),
        if (_message != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_message!)),
        if (found != null)
          ListTile(
            leading: Avatar(name: found.name, imageUrl: found.avatarImageUrl),
            title: Text(found.name),
            subtitle: Text('@${found.username}'),
            trailing: FilledButton.tonal(onPressed: () => _add(found), child: const Text('Add')),
          ),
        if (widget.selected.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final p in widget.selected)
                  InputChip(
                    avatar: Avatar(name: p.name, imageUrl: p.avatarImageUrl, size: 24),
                    label: Text(p.name),
                    onDeleted: () => widget.onChanged(widget.selected.where((s) => s.id != p.id).toList()),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}
