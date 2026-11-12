import 'package:flutter/material.dart';

import '../core/config.dart';
import '../data/chat_repository.dart';
import '../models/profile.dart';
import '../widgets/member_picker.dart';

/// Creates a group; pops with the new chat id.
class NewGroupScreen extends StatefulWidget {
  const NewGroupScreen({super.key, required this.me});

  final Profile me;

  @override
  State<NewGroupScreen> createState() => _NewGroupScreenState();
}

class _NewGroupScreenState extends State<NewGroupScreen> {
  final _title = TextEditingController();
  List<Profile> _members = const [];
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _title.dispose();
    super.dispose();
  }

  bool get _valid => _title.text.trim().isNotEmpty && _members.isNotEmpty;

  Future<void> _create() async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final chatId = await ChatRepository.createGroup(_title.text.trim(), [for (final m in _members) m.id]);
      if (mounted) Navigator.of(context).pop(chatId);
    } catch (e) {
      if (mounted) {
        setState(() {
          _saving = false;
          _error = chatActionError(e);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('New group')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          TextField(
            controller: _title,
            maxLength: AppConfig.groupTitleMax,
            textCapitalization: TextCapitalization.sentences,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(labelText: 'Group name', prefixIcon: Icon(Icons.group_outlined)),
          ),
          const SizedBox(height: 8),
          MemberPicker(meId: widget.me.id, selected: _members, onChanged: (m) => setState(() => _members = m)),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: _valid && !_saving ? _create : null,
            child: _saving
                ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : Text('Create group${_members.isEmpty ? '' : ' (${_members.length + 1})'}'),
          ),
        ],
      ),
    );
  }
}
