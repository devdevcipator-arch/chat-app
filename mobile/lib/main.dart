import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

// Passed at build time so nothing is hard-coded:
//   flutter run --dart-define=SUPABASE_URL=... --dart-define=SUPABASE_PUBLISHABLE_KEY=...
const supabaseUrl = String.fromEnvironment('SUPABASE_URL');
const supabaseKey = String.fromEnvironment('SUPABASE_PUBLISHABLE_KEY');

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  assert(supabaseUrl.isNotEmpty && supabaseKey.isNotEmpty,
      'Missing --dart-define SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY');

  await Supabase.initialize(url: supabaseUrl, anonKey: supabaseKey);
  runApp(const ChatApp());
}

final supabase = Supabase.instance.client;

class ChatApp extends StatelessWidget {
  const ChatApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Chat App',
      theme: ThemeData(colorSchemeSeed: Colors.indigo, useMaterial3: true),
      darkTheme: ThemeData(
        colorSchemeSeed: Colors.indigo,
        brightness: Brightness.dark,
        useMaterial3: true,
      ),
      home: const HomeScreen(),
    );
  }
}

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final signedIn = supabase.auth.currentSession != null;
    return Scaffold(
      body: Center(
        child: Text(signedIn ? 'Signed in' : 'Chat App — not signed in'),
      ),
    );
  }
}
