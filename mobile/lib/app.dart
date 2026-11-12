import 'dart:async';

import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'core/errors.dart';
import 'core/theme.dart';
import 'core/supabase.dart';
import 'data/profile_repository.dart';
import 'models/profile.dart';
import 'screens/call_screen.dart';
import 'screens/chat_list_screen.dart';
import 'screens/login_screen.dart';
import 'screens/onboarding_screen.dart';
import 'services/call_controller.dart';

final _navigatorKey = GlobalKey<NavigatorState>();

class ChatApp extends StatefulWidget {
  const ChatApp({super.key});

  @override
  State<ChatApp> createState() => _ChatAppState();
}

class _ChatAppState extends State<ChatApp> {
  final _calls = CallController.instance;
  Route<void>? _callRoute;

  @override
  void initState() {
    super.initState();
    _calls.addListener(_syncCallRoute);
  }

  @override
  void dispose() {
    _calls.removeListener(_syncCallRoute);
    super.dispose();
  }

  /// Shows the full-screen call UI above everything while a call exists.
  void _syncCallRoute() {
    final navigator = _navigatorKey.currentState;
    if (navigator == null) return;
    final active = _calls.phase != CallPhase.idle;
    if (active && _callRoute == null) {
      final route = MaterialPageRoute<void>(builder: (_) => const CallScreen(), fullscreenDialog: true);
      _callRoute = route;
      navigator.push(route).whenComplete(() {
        if (_callRoute == route) _callRoute = null;
      });
    } else if (!active && _callRoute != null) {
      final route = _callRoute!;
      _callRoute = null;
      if (route.isActive) navigator.removeRoute(route);
    }
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<ThemePreference>(
      valueListenable: ThemeController.instance,
      builder: (context, theme, _) => MaterialApp(
        title: 'Chat App',
        navigatorKey: _navigatorKey,
        debugShowCheckedModeBanner: false,
        theme: buildTheme(Brightness.light),
        darkTheme: buildTheme(Brightness.dark),
        themeMode: theme.mode,
        home: const AuthGate(),
      ),
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
      await CallController.instance.detach();
      _setStage(_Stage.signedOut);
      return;
    }

    if (mounted && _stage != _Stage.loading) _setStage(_Stage.loading);
    try {
      final profile = await ProfileRepository.fetchMine(userId);
      if (!mounted || generation != _generation) return;
      _profile = profile;
      ThemeController.instance.applyFromProfile(profile.theme);
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
            onProfileChanged: (p) => _profile = p,
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
