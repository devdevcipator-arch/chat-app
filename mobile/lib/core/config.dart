/// Build-time configuration, injected with:
///   flutter run --dart-define-from-file=env.json
///
/// Nothing here is secret: the publishable key is protected by Row-Level
/// Security, the R2 domain only serves public objects, and the Agora App ID
/// is handed out by /api/agora/token together with each short-lived token
/// (the App Certificate never leaves the server).
abstract final class AppConfig {
  static const supabaseUrl = String.fromEnvironment('SUPABASE_URL');
  static const supabasePublishableKey =
      String.fromEnvironment('SUPABASE_PUBLISHABLE_KEY');

  /// The Next.js platform that signs uploads and Agora tokens.
  static const apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://chat.devcipator.com',
  );

  /// Public R2 domain media keys resolve against (NEXT_PUBLIC_R2_PUBLIC_DOMAIN on the web).
  static const r2PublicBase = String.fromEnvironment('R2_PUBLIC_BASE');

  static bool get isConfigured =>
      supabaseUrl.isNotEmpty && supabasePublishableKey.isNotEmpty;

  /// Must match Auth > Providers > Email > "Email OTP Length" in Supabase.
  static const otpLength = 6;
  static const resendCooldown = Duration(seconds: 60);
  static const messageMaxLength = 4000;
  static const messagePageSize = 100;

  /// Authors may edit text messages this long after sending (edit_message RPC).
  static const editWindow = Duration(minutes: 10);

  static const groupTitleMax = 60;
}
