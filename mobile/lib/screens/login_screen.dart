import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../core/config.dart';
import '../core/errors.dart';
import '../core/supabase.dart';
import '../widgets/form_widgets.dart';
import '../widgets/otp_field.dart';

final _emailPattern = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');

/// Email OTP sign-in. On success the auth state stream (see AuthGate)
/// routes to onboarding or the chat list.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _emailController = TextEditingController();
  final _codeController = TextEditingController();

  bool _codeStep = false;
  bool _pending = false;
  String? _error;
  String _email = '';

  Timer? _resendTimer;
  int _secondsLeft = 0;

  @override
  void dispose() {
    _resendTimer?.cancel();
    _emailController.dispose();
    _codeController.dispose();
    super.dispose();
  }

  void _startResendCountdown() {
    _resendTimer?.cancel();
    setState(() => _secondsLeft = AppConfig.resendCooldown.inSeconds);
    _resendTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) return timer.cancel();
      setState(() => _secondsLeft--);
      if (_secondsLeft <= 0) timer.cancel();
    });
  }

  Future<bool> _sendCode(String email) async {
    try {
      await supabase.auth.signInWithOtp(email: email, shouldCreateUser: true);
      if (!mounted) return false;
      _startResendCountdown();
      return true;
    } catch (e) {
      if (mounted) setState(() => _error = authErrorMessage(e));
      return false;
    }
  }

  Future<void> _submitEmail() async {
    final email = _emailController.text.trim().toLowerCase();
    if (!_emailPattern.hasMatch(email)) {
      setState(() => _error = 'Please enter a valid email address.');
      return;
    }
    setState(() {
      _error = null;
      _pending = true;
    });
    final sent = await _sendCode(email);
    if (!mounted) return;
    setState(() {
      _pending = false;
      if (sent) {
        _email = email;
        _codeController.clear();
        _codeStep = true;
      }
    });
  }

  Future<void> _verify(String token) async {
    if (_pending) return;
    setState(() {
      _error = null;
      _pending = true;
    });
    try {
      await supabase.auth.verifyOTP(
        email: _email,
        token: token,
        type: OtpType.email,
      );
      // AuthGate reacts to the signedIn event and replaces this screen.
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _pending = false;
        _error = authErrorMessage(e);
      });
      _codeController.clear();
    }
  }

  Future<void> _resend() async {
    if (_secondsLeft > 0 || _pending) return;
    setState(() {
      _error = null;
      _pending = true;
    });
    await _sendCode(_email);
    if (mounted) setState(() => _pending = false);
  }

  Future<void> _pasteCode() async {
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    final digits = (data?.text ?? '').replaceAll(RegExp(r'\D'), '');
    if (digits.isEmpty) return;
    final code = digits.length > AppConfig.otpLength
        ? digits.substring(0, AppConfig.otpLength)
        : digits;
    _codeController.value = TextEditingValue(
      text: code,
      selection: TextSelection.collapsed(offset: code.length),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 250),
                transitionBuilder: (child, animation) => FadeTransition(
                  opacity: animation,
                  child: SlideTransition(
                    position: Tween(begin: const Offset(0.05, 0), end: Offset.zero)
                        .animate(animation),
                    child: child,
                  ),
                ),
                child: _codeStep ? _buildCodeStep(context) : _buildEmailStep(context),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildEmailStep(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Column(
      key: const ValueKey('email'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const _LockBadge(),
        const SizedBox(height: 24),
        Text('Sign in', style: text.headlineSmall?.copyWith(fontWeight: FontWeight.w600)),
        const SizedBox(height: 6),
        Text(
          "We'll email you a ${AppConfig.otpLength}-digit code. No password, no phone number.",
          style: text.bodyMedium?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
        ),
        const SizedBox(height: 24),
        TextField(
          controller: _emailController,
          enabled: !_pending,
          autofocus: true,
          keyboardType: TextInputType.emailAddress,
          textInputAction: TextInputAction.go,
          autofillHints: const [AutofillHints.email],
          autocorrect: false,
          onChanged: (_) {
            if (_error != null) setState(() => _error = null);
          },
          onSubmitted: (_) => _submitEmail(),
          decoration: const InputDecoration(
            labelText: 'Email',
            hintText: 'you@example.com',
            border: OutlineInputBorder(),
          ),
        ),
        ErrorBanner(_error),
        const SizedBox(height: 20),
        FilledButton(
          onPressed: _pending ? null : _submitEmail,
          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
          child: _pending ? const ButtonSpinner() : const Text('Continue'),
        ),
        const SizedBox(height: 20),
        Text(
          'Your email is only used to sign you in. Other people see your @username, never your email.',
          style: text.bodySmall?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
        ),
      ],
    );
  }

  Widget _buildCodeStep(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    return Column(
      key: const ValueKey('code'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const _LockBadge(),
        const SizedBox(height: 24),
        Text('Check your email', style: text.headlineSmall?.copyWith(fontWeight: FontWeight.w600)),
        const SizedBox(height: 6),
        Text.rich(
          TextSpan(
            text: 'Enter the code we sent to ',
            children: [
              TextSpan(text: _email, style: const TextStyle(fontWeight: FontWeight.w600)),
            ],
          ),
          style: text.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
        ),
        const SizedBox(height: 24),
        OtpField(
          length: AppConfig.otpLength,
          controller: _codeController,
          enabled: !_pending,
          hasError: _error != null,
          onCompleted: _verify,
        ),
        ErrorBanner(_error),
        const SizedBox(height: 20),
        FilledButton(
          onPressed: _pending ? null : () {
            final code = _codeController.text;
            if (code.length == AppConfig.otpLength) _verify(code);
          },
          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
          child: _pending ? const ButtonSpinner() : const Text('Verify'),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            TextButton.icon(
              onPressed: _pending
                  ? null
                  : () => setState(() {
                        _codeStep = false;
                        _error = null;
                        _codeController.clear();
                      }),
              icon: const Icon(Icons.arrow_back, size: 18),
              label: const Text('Change email'),
            ),
            const Spacer(),
            TextButton(
              onPressed: _pending ? null : _pasteCode,
              child: const Text('Paste'),
            ),
            TextButton(
              onPressed: _secondsLeft > 0 || _pending ? null : _resend,
              child: Text(_secondsLeft > 0 ? 'Resend in ${_secondsLeft}s' : 'Resend code'),
            ),
          ],
        ),
      ],
    );
  }
}

class _LockBadge extends StatelessWidget {
  const _LockBadge();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        width: 48,
        height: 48,
        decoration: BoxDecoration(
          color: scheme.primary,
          borderRadius: BorderRadius.circular(14),
        ),
        child: Icon(Icons.lock_outline, color: scheme.onPrimary),
      ),
    );
  }
}
