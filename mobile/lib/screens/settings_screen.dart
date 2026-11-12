import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';

import '../core/api.dart';
import '../core/errors.dart';
import '../core/supabase.dart';
import '../core/theme.dart';
import '../data/profile_repository.dart';
import '../models/profile.dart';
import '../widgets/avatar.dart';

/// Profile (display name, photo) and appearance. Pops with the updated profile.
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key, required this.me, required this.onProfileChanged});

  final Profile me;
  final ValueChanged<Profile> onProfileChanged;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late Profile _me = widget.me;
  late final _name = TextEditingController(text: widget.me.displayName ?? '');
  bool _savingName = false;
  bool _photoBusy = false;
  String? _nameError;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  void _snack(String text) => ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(text)));

  void _update(Profile profile) {
    setState(() => _me = profile);
    widget.onProfileChanged(profile);
  }

  Future<void> _saveName() async {
    final name = ProfileRepository.normalizeDisplayName(_name.text);
    if (name.length > ProfileRepository.displayNameMax) {
      setState(() => _nameError = 'Use ${ProfileRepository.displayNameMax} characters or fewer.');
      return;
    }
    FocusScope.of(context).unfocus();
    setState(() {
      _savingName = true;
      _nameError = null;
    });
    try {
      final updated = await ProfileRepository.updateDisplayName(_me.id, name);
      _update(_me.copyWith(displayName: updated.displayName ?? ''));
      _snack('Name saved');
    } catch (e) {
      setState(() => _nameError = dbErrorMessage(e));
    } finally {
      if (mounted) setState(() => _savingName = false);
    }
  }

  Future<void> _changePhoto(ImageSource source) async {
    try {
      final picked = await ImagePicker().pickImage(source: source, maxWidth: 512, maxHeight: 512, imageQuality: 85);
      if (picked == null) return;
      setState(() => _photoBusy = true);
      final key = await ProfileRepository.uploadAvatar(File(picked.path));
      _update(_me.copyWith(avatarUrl: key));
      _snack('Photo updated');
    } on PlatformException {
      _snack("Couldn't open the camera or photos.");
    } catch (e) {
      _snack(e is ApiException ? e.message : "Couldn't update your photo.");
    } finally {
      if (mounted) setState(() => _photoBusy = false);
    }
  }

  Future<void> _removePhoto() async {
    setState(() => _photoBusy = true);
    try {
      await ProfileRepository.removeAvatar();
      _update(_me.copyWith(clearAvatar: true));
      _snack('Photo removed');
    } catch (e) {
      _snack(e is ApiException ? e.message : "Couldn't remove your photo.");
    } finally {
      if (mounted) setState(() => _photoBusy = false);
    }
  }

  Future<void> _photoMenu() async {
    final choice = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Wrap(
          children: [
            ListTile(leading: const Icon(Icons.photo_library_outlined), title: const Text('Choose photo'), onTap: () => Navigator.pop(context, 'gallery')),
            ListTile(leading: const Icon(Icons.photo_camera_outlined), title: const Text('Take photo'), onTap: () => Navigator.pop(context, 'camera')),
            if (_me.avatarUrl != null)
              ListTile(
                leading: Icon(Icons.delete_outline, color: Theme.of(context).colorScheme.error),
                title: Text('Remove photo', style: TextStyle(color: Theme.of(context).colorScheme.error)),
                onTap: () => Navigator.pop(context, 'remove'),
              ),
          ],
        ),
      ),
    );
    switch (choice) {
      case 'gallery':
        await _changePhoto(ImageSource.gallery);
      case 'camera':
        await _changePhoto(ImageSource.camera);
      case 'remove':
        await _removePhoto();
    }
  }

  Future<void> _setTheme(ThemePreference preference) async {
    try {
      await ThemeController.instance.choose(preference, _me.id);
      _update(_me.copyWith(theme: preference));
    } catch (_) {
      _snack("Couldn't save your theme. Please try again.");
    }
  }

  Future<void> _signOut() async {
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

  @override
  Widget build(BuildContext context) {
    final email = supabase.auth.currentUser?.email;
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Center(
            child: Stack(
              children: [
                InkWell(
                  customBorder: const CircleBorder(),
                  onTap: _photoBusy ? null : _photoMenu,
                  child: Avatar(name: _me.name, imageUrl: _me.avatarImageUrl, size: 104),
                ),
                if (_photoBusy)
                  const Positioned.fill(child: Center(child: CircularProgressIndicator())),
                Positioned(
                  right: 0,
                  bottom: 0,
                  child: IconButton.filled(
                    tooltip: 'Change photo',
                    onPressed: _photoBusy ? null : _photoMenu,
                    icon: const Icon(Icons.photo_camera, size: 18),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          Text('@${_me.username}', textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleMedium),
          if (email != null) Text(email, textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 24),
          Text('Profile', style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 8),
          TextField(
            controller: _name,
            maxLength: ProfileRepository.displayNameMax,
            textCapitalization: TextCapitalization.words,
            onSubmitted: (_) => _saveName(),
            decoration: InputDecoration(
              labelText: 'Display name',
              helperText: 'Leave empty to show your @username.',
              errorText: _nameError,
              suffixIcon: _savingName
                  ? const Padding(padding: EdgeInsets.all(12), child: SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2)))
                  : IconButton(tooltip: 'Save', onPressed: _saveName, icon: const Icon(Icons.check)),
            ),
          ),
          const SizedBox(height: 24),
          Text('Appearance', style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 8),
          ValueListenableBuilder<ThemePreference>(
            valueListenable: ThemeController.instance,
            builder: (context, theme, _) => SegmentedButton<ThemePreference>(
              segments: const [
                ButtonSegment(value: ThemePreference.light, icon: Icon(Icons.light_mode_outlined), label: Text('Light')),
                ButtonSegment(value: ThemePreference.dark, icon: Icon(Icons.dark_mode_outlined), label: Text('Dark')),
                ButtonSegment(value: ThemePreference.system, icon: Icon(Icons.brightness_auto_outlined), label: Text('System')),
              ],
              selected: {theme},
              onSelectionChanged: (s) => _setTheme(s.first),
            ),
          ),
          const SizedBox(height: 32),
          OutlinedButton.icon(onPressed: _signOut, icon: const Icon(Icons.logout), label: const Text('Sign out')),
          const SizedBox(height: 24),
          Text(
            'Powered by Devcipator',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}
