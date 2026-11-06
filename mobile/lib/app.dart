import 'dart:async';

import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'core/errors.dart';
import 'core/supabase.dart';
import 'data/profile_repository.dart';
import 'models/profile.dart';
import 'screens/chat_list_screen.dart';
import 'screens/login_screen.dart';
import 'screens/onboarding_screen.dart';

final _navigatorKey = GlobalKey<NavigatorState>();

class ChatApp extends StatelessWidget {
  const ChatApp({super.key});

  @override
  Widget build(BuildContext context) {
    const seed = Color(0xFF4F46E5); // indigo-600, matches the web app
    return MaterialApp(
      title: 'Chat App',
      navigatorKey: _navigatorKey,
      debugShowCheckedModeBanner: false,
      theme: ThemeData(colorSchemeSeed: seed, useMaterial3: true),
      darkTheme: ThemeData(
        colorSchemeSeed: seed,
        brightness: Brightness.dark,
        useMaterial3: true,
      ),
      home: const AuthGate(),
    );
  }
}

enum _Stage { loading, signedOut, onboarding, ready, error }

/// Mirrors the web route guard: signed out -> login, no username ->
/// onboarding, otherwise -> chats. Driven by the Supabase auth stream.
class AuthGate extends StatefulWidget {
  const AuthGate({super.key});

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  late final StreamSubscription<AuthState> _authSub;
  _Stage _stage = _Stage.loading;
  Profile? _profile;
  String? _userId;
  String? _error;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    final session = supabase.auth.currentSession;
    if (session == null) {
      _stage = _Stage.signedOut;
    } else {
      _resolve(session);
    }
    _authSub = supabase.auth.onAuthStateChange.listen(
      _onAuthState,
      onError: (Object e) {
        // e.g. an expired refresh token: treat as signed out.
        if (mounted) _setStage(_Stage.signedOut);
      },
    );
  }

  @override
  void dispose() {
    _authSub.cancel();
    super.dispose();
  }

  void _onAuthState(AuthState state) {
    final session = state.session;
    switch (state.event) {
      case AuthChangeEvent.signedOut:
        _resolve(null);
      case AuthChangeEvent.initialSession:
      case AuthChangeEvent.signedIn:
      case AuthChangeEvent.userUpdated:
      case AuthChangeEvent.tokenRefreshed:
        // Token refreshes for the same user need no re-routing.
        if (session?.user.id == _userId && _stage != _Stage.error) return;
        _resolve(session);
      default:
        break;
    }
  }

  Future<void> _resolve(Session? session) async {
    final generation = ++_generation;
    final userId = session?.user.id;
    _userId = userId;

    if (userId == null) {
      _profile = null;
      _setStage(_Stage.signedOut);
      return;
    }

    if (mounted && _stage != _Stage.loading) _setStage(_Stage.loading);
    try {
      final profile = await ProfileRepository.fetchMine(userId);
      if (!mounted || generation != _generation) return;
      _profile = profile;
      _setStage(profile.hasUsername ? _Stage.ready : _Stage.onboarding);
    } catch (e) {
      if (!mounted || generation != _generation) return;
      _error = dbErrorMessage(e);
      _setStage(_Stage.error);
    }
  }

  void _setStage(_Stage stage) {
    if (!mounted) {
      _stage = stage;
      return;
    }
    // Drop any pushed routes (e.g. an open chat) when the account changes.
    _navigatorKey.currentState?.popUntil((route) => route.isFirst);
    setState(() => _stage = stage);
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 300),
      child: switch (_stage) {
        _Stage.loading => const Scaffold(
            key: ValueKey('loading'),
            body: Center(child: CircularProgressIndicator()),
          ),
        _Stage.signedOut => const LoginScreen(key: ValueKey('login')),
        _Stage.onboarding => OnboardingScreen(
            key: const ValueKey('onboarding'),
            userId: _profile!.id,
            onCompleted: (profile) {
              _profile = profile;
              _setStage(_Stage.ready);
            },
          ),
        _Stage.ready => ChatListScreen(
            key: ValueKey('chats:${_profile!.id}'),
            me: _profile!,
          ),
        _Stage.error => Scaffold(
            key: const ValueKey('error'),
            body: Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(_error ?? 'Something went wrong.', textAlign: TextAlign.center),
                    const SizedBox(height: 16),
                    FilledButton(
                      onPressed: () => _resolve(supabase.auth.currentSession),
                      child: const Text('Try again'),
                    ),
                    TextButton(
                      onPressed: () => supabase.auth.signOut(),
                      child: const Text('Sign out'),
                    ),
                  ],
                ),
              ),
            ),
          ),
      },
    );
  }
}
