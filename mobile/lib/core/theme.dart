import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'supabase.dart';

// Devcipator palette (web/src/app/globals.css): neon-orange accent on a
// pitch-black canvas in dark mode, white in light mode.

const brandOrange = Color(0xFFFF5722);
const brandOrangeLight = Color(0xFFFF6B35);

ThemeData buildTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final scheme = ColorScheme.fromSeed(
    seedColor: brandOrange,
    brightness: brightness,
  ).copyWith(
    primary: brandOrange,
    onPrimary: Colors.white,
    surface: dark ? const Color(0xFF0A0A0A) : Colors.white,
    surfaceContainerLowest: dark ? const Color(0xFF0A0A0A) : Colors.white,
    surfaceContainerLow: dark ? const Color(0xFF111111) : const Color(0xFFFAFAFA),
    surfaceContainer: dark ? const Color(0xFF141414) : const Color(0xFFF4F4F5),
    surfaceContainerHigh: dark ? const Color(0xFF1F1F1F) : const Color(0xFFEDEDEF),
    surfaceContainerHighest: dark ? const Color(0xFF2C2C2C) : const Color(0xFFE4E4E7),
    onSurfaceVariant: dark ? const Color(0xFF9CA3AF) : const Color(0xFF71717A),
    outlineVariant: dark ? const Color(0xFF2C2C2C) : const Color(0xFFE4E4E7),
  );
  return ThemeData(
    colorScheme: scheme,
    useMaterial3: true,
    scaffoldBackgroundColor: scheme.surface,
    appBarTheme: AppBarTheme(
      backgroundColor: scheme.surface,
      surfaceTintColor: Colors.transparent,
      scrolledUnderElevation: 0,
    ),
  );
}

/// Light / Dark / System, as stored in profiles.theme_preference.
enum ThemePreference {
  light,
  dark,
  system;

  static ThemePreference parse(Object? value) =>
      ThemePreference.values.firstWhere((t) => t.name == value, orElse: () => ThemePreference.dark);

  ThemeMode get mode => switch (this) {
        ThemePreference.light => ThemeMode.light,
        ThemePreference.dark => ThemeMode.dark,
        ThemePreference.system => ThemeMode.system,
      };

  String get label => switch (this) {
        ThemePreference.light => 'Light',
        ThemePreference.dark => 'Dark',
        ThemePreference.system => 'System',
      };
}

/// App-wide theme choice. Cached locally so the first frame is right, and
/// synced to the profile so it follows the user across devices and the web.
class ThemeController extends ValueNotifier<ThemePreference> {
  ThemeController._() : super(ThemePreference.dark);
  static final instance = ThemeController._();

  static const _key = 'theme_preference';

  Future<void> loadCached() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      value = ThemePreference.parse(prefs.getString(_key));
    } catch (_) {}
  }

  /// Applies the server value (e.g. changed on the web) without writing back.
  void applyFromProfile(ThemePreference preference) {
    value = preference;
    _cache(preference);
  }

  /// Applies immediately; throws if saving to the profile fails (and reverts).
  Future<void> choose(ThemePreference preference, String userId) async {
    final previous = value;
    value = preference;
    try {
      await supabase.from('profiles').update({'theme_preference': preference.name}).eq('id', userId);
      await _cache(preference);
    } catch (_) {
      value = previous;
      rethrow;
    }
  }

  Future<void> _cache(ThemePreference preference) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_key, preference.name);
    } catch (_) {}
  }
}
