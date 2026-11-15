import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';

import '../core/errors.dart';

/// App-wide online/offline state (`value` is true while online).
///
/// Combines what the OS reports (Wi-Fi / mobile data / airplane mode) with
/// what our own requests see: a request that never reached the server marks
/// us offline even if the OS thinks a network is up, and any successful
/// request marks us online again.
///
/// [reconnects] fires whenever we come back online, and periodically while
/// the server is unreachable on an otherwise "up" network, so screens can
/// re-sync and re-subscribe to Realtime.
class NetworkStatus extends ValueNotifier<bool> {
  NetworkStatus._() : super(true);
  static final instance = NetworkStatus._();

  static const retryInterval = Duration(seconds: 15);

  final _reconnects = StreamController<void>.broadcast();
  StreamSubscription<List<ConnectivityResult>>? _sub;
  Timer? _retryTimer;
  bool _networkUp = true;
  bool _serverUnreachable = false;

  Stream<void> get reconnects => _reconnects.stream;
  bool get isOnline => value;

  /// Starts watching the OS connectivity. Never awaited on the startup path.
  void start() {
    if (_sub != null) return;
    final connectivity = Connectivity();
    _sub = connectivity.onConnectivityChanged.listen(_onResults, onError: (_) {});
    unawaited(connectivity.checkConnectivity().then(_onResults).catchError((_) {}));
  }

  void _onResults(List<ConnectivityResult> results) {
    final up = results.any((r) => r != ConnectivityResult.none);
    if (up == _networkUp) return;
    _networkUp = up;
    // A new network is a fresh chance to reach the server.
    if (up) _serverUnreachable = false;
    _update();
  }

  /// Call with any failed request's error; only network failures count.
  void reportFailure(Object error) {
    if (!isOfflineError(error) || _serverUnreachable) return;
    _serverUnreachable = true;
    _update();
  }

  /// Call after any request that reached the server.
  void reportSuccess() {
    if (!_serverUnreachable) return;
    _serverUnreachable = false;
    _update();
  }

  void _update() {
    final online = _networkUp && !_serverUnreachable;
    final cameBack = online && !value;
    value = online;

    _retryTimer?.cancel();
    _retryTimer = null;
    if (_networkUp && _serverUnreachable) {
      _retryTimer = Timer.periodic(retryInterval, (_) => _reconnects.add(null));
    }
    if (cameBack) _reconnects.add(null);
  }
}
