import 'dart:async';

import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../core/errors.dart';
import '../core/supabase.dart';
import '../core/username.dart';
import '../data/profile_repository.dart';
import '../models/profile.dart';
import '../widgets/form_widgets.dart';

enum _Availability { idle, invalid, checking, available, taken, error }

const _debounce = Duration(milliseconds: 400);

/// First-run identity setup: unique @username + optional display name.
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key, required this.userId, required this.onCompleted});

  final String userId;
  final ValueChanged<Profile> onCompleted;

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _usernameController = TextEditingController();
  final _displayNameController = TextEditingController();

  _Availability _availability = _Availability.idle;
  bool _pending = false;
  bool _done = false;
  String? _error;
  Timer? _timer;
  String _latest = '';

  @override
  void dispose() {
    _timer?.cancel();
    _usernameController.dispose();
    _displayNameController.dispose();
    super.dispose();
  }

  void _onUsernameChanged(String value) {
    _timer?.cancel();
    _latest = value;
    setState(() {
      _error = null;
      if (value.isEmpty) {
        _availability = _Availability.idle;
      } else if (!isValidUsername(value)) {
        _availability = _Availability.invalid;
      } else {
        _availability = _Availability.checking;
        _timer = Timer(_debounce, () => _checkAvailability(value));
      }
    });
  }

  Future<void> _checkAvailability(String candidate) async {
    _Availability result;
    try {
      final match = await ProfileRepository.findByUsername(candidate);
      result = match == null || match.id == widget.userId
          ? _Availability.available
          : _Availability.taken;
    } catch (_) {
      result = _Availability.error;
    }
    // Ignore stale responses: a newer keystroke won.
    if (!mounted || _latest != candidate) return;
    setState(() => _availability = result);
  }

  bool get _canSubmit =>
      !_pending &&
      isValidUsername(_usernameController.text) &&
      _availability != _Availability.taken &&
      _availability != _Availability.checking;

  Future<void> _submit() async {
    if (!_canSubmit) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _error = null;
      _pending = true;
    });
    try {
      final profile = await ProfileRepository.completeOnboarding(
        userId: widget.userId,
        username: _usernameController.text,
        displayName: _displayNameController.text,
      );
      if (!mounted) return;
      setState(() => _done = true);
      // Let the success animation play, then move on.
      await Future<void>.delayed(const Duration(milliseconds: 800));
      if (mounted) widget.onCompleted(profile);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _pending = false;
        if (e is PostgrestException && e.code == '23505') {
          _availability = _Availability.taken;
        }
        _error = dbErrorMessage(e);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        actions: [
          TextButton(
            onPressed: _pending ? null : () => supabase.auth.signOut(),
            child: const Text('Sign out'),
          ),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 300),
                child: _done ? _buildDone(context) : _buildForm(context),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildDone(BuildContext context) {
    return Column(
      key: const ValueKey('done'),
      mainAxisSize: MainAxisSize.min,
      children: [
        TweenAnimationBuilder<double>(
          tween: Tween(begin: 0, end: 1),
          duration: const Duration(milliseconds: 450),
          curve: Curves.elasticOut,
          builder: (context, scale, child) => Transform.scale(scale: scale, child: child),
          child: const CircleAvatar(
            radius: 28,
            backgroundColor: Color(0xFF10B981),
            child: Icon(Icons.check, color: Colors.white, size: 32),
          ),
        ),
        const SizedBox(height: 16),
        Text(
          "You're all set, @${_usernameController.text}",
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 4),
        const Text('Opening your chats…'),
      ],
    );
  }

  Widget _buildForm(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;

    final (hint, hintColor) = switch (_availability) {
      _Availability.idle => ('3–20 characters: lowercase letters, numbers, underscores.', scheme.onSurfaceVariant),
      _Availability.invalid => ('3–20 characters: lowercase letters, numbers, underscores.', Colors.orange.shade700),
      _Availability.checking => ('Checking availability…', scheme.onSurfaceVariant),
      _Availability.available => ('Available', Colors.green.shade600),
      _Availability.taken => ('That username is taken.', scheme.error),
      _Availability.error => ("Couldn't check right now. You can still try to continue.", Colors.orange.shade700),
    };

    final Widget? suffix = switch (_availability) {
      _Availability.checking => const Padding(
          padding: EdgeInsets.all(14),
          child: SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2)),
        ),
      _Availability.available => Icon(Icons.check_circle, color: Colors.green.shade600),
      _Availability.taken => Icon(Icons.cancel, color: scheme.error),
      _ => null,
    };

    return Column(
      key: const ValueKey('form'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Choose your identity', style: text.headlineSmall?.copyWith(fontWeight: FontWeight.w600)),
        const SizedBox(height: 6),
        Text(
          'People find you by your @username. Your email stays private.',
          style: text.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
        ),
        const SizedBox(height: 24),
        TextField(
          controller: _usernameController,
          enabled: !_pending,
          autofocus: true,
          autocorrect: false,
          enableSuggestions: false,
          textInputAction: TextInputAction.next,
          inputFormatters: [UsernameInputFormatter()],
          onChanged: _onUsernameChanged,
          decoration: InputDecoration(
            labelText: 'Username',
            prefixText: '@',
            hintText: 'your_name',
            border: const OutlineInputBorder(),
            suffixIcon: suffix,
            helperText: hint,
            helperMaxLines: 2,
            helperStyle: TextStyle(color: hintColor),
          ),
        ),
        const SizedBox(height: 16),
        TextField(
          controller: _displayNameController,
          enabled: !_pending,
          maxLength: displayNameMaxLength,
          textCapitalization: TextCapitalization.words,
          textInputAction: TextInputAction.done,
          onSubmitted: (_) => _submit(),
          decoration: InputDecoration(
            labelText: 'Display name (optional)',
            hintText: _usernameController.text.isEmpty
                ? 'Shown next to your messages'
                : _usernameController.text,
            border: const OutlineInputBorder(),
          ),
        ),
        ErrorBanner(_error),
        const SizedBox(height: 16),
        FilledButton(
          onPressed: _canSubmit ? _submit : null,
          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
          child: _pending ? const ButtonSpinner() : const Text('Continue'),
        ),
      ],
    );
  }
}
