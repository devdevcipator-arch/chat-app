import 'package:supabase_flutter/supabase_flutter.dart';

const _generic = 'Something went wrong. Please try again.';
const _offline = "Can't reach the server. Check your connection and try again.";

const _emailFailed =
    "We couldn't send the sign-in email right now. Please try again in a few minutes.";
const _serverProblem = 'The server ran into a problem. Please try again shortly.';

final _emailSendError = RegExp(r'sending .*email', caseSensitive: false);

bool _looksOffline(Object error) {
  final text = error.toString();
  // Retryable errors also cover 5xx responses; only a missing status code
  // means the request never reached the server.
  return (error is AuthRetryableFetchException &&
          (error.statusCode == null || error.statusCode == '0')) ||
      text.contains('SocketException') ||
      text.contains('ClientException') ||
      text.contains('Failed host lookup');
}

/// User-friendly message for Supabase Auth errors.
String authErrorMessage(Object error) {
  if (_looksOffline(error)) return _offline;
  if (error is! AuthException) return _generic;
  if (_emailSendError.hasMatch(error.message)) return _emailFailed;
  if (error is AuthRetryableFetchException) return _serverProblem;

  switch (error.code) {
    case 'otp_expired':
      return 'That code is invalid or has expired. Check it or request a new one.';
    case 'over_email_send_rate_limit':
      return 'Too many codes sent to this email. Please wait a few minutes and try again.';
    case 'over_request_rate_limit':
      return 'Too many attempts. Please wait a moment and try again.';
    case 'email_address_invalid':
      return 'Please enter a valid email address.';
    case 'signup_disabled':
      return 'New sign-ups are currently closed.';
    case 'email_provider_disabled':
    case 'otp_disabled':
      return 'Email sign-in is currently unavailable.';
  }
  if (error.statusCode == '429') {
    return 'Too many attempts. Please wait a moment and try again.';
  }
  return _generic;
}

/// User-friendly message for database (PostgREST) errors.
String dbErrorMessage(Object error) {
  if (_looksOffline(error)) return _offline;
  if (error is PostgrestException) {
    switch (error.code) {
      case '23505':
        return 'That username was just taken. Please pick another.';
      case '23514':
        return "Please check your details: something doesn't meet the requirements.";
      case '42501':
        return 'Your session has expired. Please sign in again.';
      case 'P0002':
        return 'That user no longer exists.';
    }
  }
  return _generic;
}
