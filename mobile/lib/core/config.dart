/// Build-time configuration, injected with:
///   flutter run --dart-define-from-file=env.json
///
/// The publishable key is safe to ship in the app: Row-Level Security in the
/// database is what protects data, not the key.
abstract final class AppConfig {
  static const supabaseUrl = String.fromEnvironment('SUPABASE_URL');
  static const supabasePublishableKey =
      String.fromEnvironment('SUPABASE_PUBLISHABLE_KEY');

  static bool get isConfigured =>
      supabaseUrl.isNotEmpty && supabasePublishableKey.isNotEmpty;

  /// Must match Auth > Providers > Email > "Email OTP Length" in Supabase.
  static const otpLength = 6;
  static const resendCooldown = Duration(seconds: 60);
  static const messageMaxLength = 4000;
  static const messagePageSize = 100;
}
