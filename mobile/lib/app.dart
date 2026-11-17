import 'dart:async';

import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'core/errors.dart';
import 'core/responsive.dart';
import 'core/theme.dart';
import 'core/supabase.dart';
import 'data/local_cache.dart';
import 'data/profile_repository.dart';
import 'models/profile.dart';
import 'screens/call_screen.dart';
import 'screens/chat_list_screen.dart';
import 'screens/login_screen.dart';
import 'screens/onboarding_screen.dart';
import 'services/call_controller.dart';
import 'services/missed_calls.dart';
import 'services/network_status.dart';

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
        builder: (context, child) => CompactScope(child: child ?? const SizedBox.shrink()),
        home: const AuthGate(),
      ),
    );
  }
}

enum _Stage { loading, signedOut, onboarding, ready, error }

/// Mirrors the web route guard: signed out -> login, no username ->
/// onboarding, otherwise -> chats. Driven by the Supabase auth stream.
///
/// Offline-first: a signed-in user with a cached profile goes straight to
/// Chats on the first frame, and the profile refreshes in the background.
/// Network failures never sign anyone out; only an explicit sign-out or the
/// server rejecting the refresh token (a `signedOut` event from gotrue) does.
class AuthGate extends StatefulWidget {
  const AuthGate({super.key});

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  late final StreamSubscription<AuthState> _authSub;
  late final StreamSubscription<void> _reconnectSub;
  _Stage _stage = _Stage.loading;
  Profile? _profile;
  String? _userId;
  String? _error;
  int _generation = 0;

  /// Whether [_profile] came from the server in this generation (vs. cache).
  bool _profileSynced = false;

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
        // Token refreshes that fail for network reasons land here. The
        // session is still stored and gotrue keeps retrying; a refresh token
        // the server rejects arrives as a `signedOut` event instead. So this
        // must never route to sign-in.
        debugPrint('Auth stream error (session kept): $e');
        NetworkStatus.instance.reportFailure(e);
      },
    );
    _reconnectSub = NetworkStatus.instance.reconnects.listen((_) => _onReconnect());
  }

  @override
  void dispose() {
    _authSub.cancel();
    _reconnectSub.cancel();
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

  /// Back online: finish anything that had to wait for the network.
  void _onReconnect() {
    final session = supabase.auth.currentSession;
    final userId = _userId;
    if (session == null || userId == null) return;
    if (session.isExpired) {
      // A rejected refresh token signs out via the auth stream; anything
      // else (still flaky network) is reported there and ignored.
      unawaited(supabase.auth.refreshSession().then((_) {}, onError: (_) {}));
    }
    if (_stage == _Stage.error) {
      _resolve(session);
    } else if (!_profileSynced) {
      unawaited(_syncProfile(userId, _generation));
    }
  }

  Future<void> _resolve(Session? session) async {
    final generation = ++_generation;
    final user = session?.user;
    _userId = user?.id;
    _profileSynced = false;

    if (user == null) {
      _profile = null;
      MissedCalls.instance.detach();
      await CallController.instance.detach();
      await LocalCache.clear();
      _setStage(_Stage.signedOut);
      return;
    }

    unawaited(LocalCache.saveUser(user.id, email: user.email));
    final cached = LocalCache.profile(user.id);
    if (cached != null && cached.hasUsername) {
      // Instant start (also offline): show Chats now, refresh quietly.
      _profile = cached;
      _setStage(_Stage.ready);
      unawaited(_syncProfile(user.id, generation));
      return;
    }

    if (mounted && _stage != _Stage.loading) _setStage(_Stage.loading);
    await _syncProfile(user.id, generation, blocking: true);
  }

  /// Fetches my profile. In the background ([blocking] false) failures keep
  /// the cached profile; otherwise an offline failure still opens Chats.
  Future<void> _syncProfile(String userId, int generation, {bool blocking = false}) async {
    try {
      final profile = await ProfileRepository.fetchMine(userId).timeout(const Duration(seconds: 20));
      NetworkStatus.instance.reportSuccess();
      if (!mounted || generation != _generation) return;
      _profile = profile;
      _profileSynced = true;
      unawaited(LocalCache.saveProfile(profile));
      ThemeController.instance.applyFromProfile(profile.theme);
      final stage = profile.hasUsername ? _Stage.ready : _Stage.onboarding;
      if (stage != _stage) {
        _setStage(stage);
      } else {
        setState(() {}); // hand the fresh profile to the chat list
      }
    } catch (e) {
      NetworkStatus.instance.reportFailure(e);
      if (!mounted || generation != _generation || !blocking) return;
      if (isOfflineError(e)) {
        // Signed in, offline, nothing cached yet (e.g. first launch after an
        // update): open Chats anyway; the profile syncs on reconnect.
        _profile = Profile(id: userId);
        _setStage(_Stage.ready);
      } else {
        _error = dbErrorMessage(e);
        _setStage(_Stage.error);
      }
    }
  }

  void _onProfileChanged(Profile profile) {
    _profile = profile;
    unawaited(LocalCache.saveProfile(profile));
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
              _onProfileChanged(profile);
              _profileSynced = true;
              _setStage(_Stage.ready);
            },
          ),
        _Stage.ready => ChatListScreen(
            key: ValueKey('chats:${_profile!.id}'),
            me: _profile!,
            onProfileChanged: _onProfileChanged,
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
