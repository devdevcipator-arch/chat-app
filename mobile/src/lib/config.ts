/**
 * Build-time configuration. Expo inlines `process.env.EXPO_PUBLIC_*` into the
 * bundle, so each variable must be referenced literally (no dynamic lookup).
 *
 * Nothing here is secret: the publishable key is protected by Row-Level
 * Security, the R2 domain only serves public objects, and the Agora App ID
 * comes back from /api/agora/token with each short-lived token.
 */
const trim = (value: string | undefined) => (value ?? "").trim();

export const Config = {
  supabaseUrl: trim(process.env.EXPO_PUBLIC_SUPABASE_URL),
  supabasePublishableKey: trim(process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
  /** The Next.js platform that signs uploads and Agora tokens. */
  apiBaseUrl: trim(process.env.EXPO_PUBLIC_API_BASE_URL).replace(/\/+$/, "") || "https://chat.devcipator.com",
  /** Public R2 domain media keys resolve against (NEXT_PUBLIC_R2_PUBLIC_DOMAIN on the web). */
  r2PublicBase: trim(process.env.EXPO_PUBLIC_R2_PUBLIC_BASE),

  /** Must match Auth > Providers > Email > "Email OTP Length" in Supabase. */
  otpLength: 6,
  resendCooldownSeconds: 60,
  messageMaxLength: 4000,
  messagePageSize: 100,
  /** Authors may edit text messages this long after sending (edit_message RPC). */
  editWindowMs: 10 * 60 * 1000,
  groupTitleMax: 60,
  displayNameMax: 50,
} as const;

export const isConfigured = Config.supabaseUrl.length > 0 && Config.supabasePublishableKey.length > 0;
