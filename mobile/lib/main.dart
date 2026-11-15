import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'app.dart';
import 'core/config.dart';
import 'core/theme.dart';
import 'data/local_cache.dart';
import 'services/network_status.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  if (!AppConfig.isConfigured) {
    runApp(const _MissingConfigApp());
    return;
  }

  // All local: Supabase restores the persisted session from disk (its token
  // refresh runs in the background and never blocks launch), and the theme
  // and chat cache are read from SharedPreferences. No network round-trips
  // happen before the first frame.
  await Future.wait([
    Supabase.initialize(
      url: AppConfig.supabaseUrl,
      publishableKey: AppConfig.supabasePublishableKey,
    ),
    ThemeController.instance.loadCached(),
    LocalCache.init(),
  ]);
  runApp(const ChatApp());
  NetworkStatus.instance.start();
}

/// Shown instead of crashing when the app was built without env.json.
class _MissingConfigApp extends StatelessWidget {
  const _MissingConfigApp();

  @override
  Widget build(BuildContext context) {
    return const MaterialApp(
      home: Scaffold(
        body: Center(
          child: Padding(
            padding: EdgeInsets.all(24),
            child: Text(
              'Missing Supabase configuration.\n\n'
              'Build with: --dart-define-from-file=env.json',
              textAlign: TextAlign.center,
            ),
          ),
        ),
      ),
    );
  }
}
