import 'package:flutter/services.dart';

// Must match the `username_format` check constraint in the database.
final usernamePattern = RegExp(r'^[a-z0-9_]{3,20}$');
const usernameMaxLength = 20;
const displayNameMaxLength = 50;

/// Lowercases and strips characters that can never be part of a username.
String normalizeUsername(String input) {
  final cleaned = input
      .toLowerCase()
      .replaceFirst(RegExp(r'^@'), '')
      .replaceAll(RegExp(r'[^a-z0-9_]'), '');
  return cleaned.length > usernameMaxLength
      ? cleaned.substring(0, usernameMaxLength)
      : cleaned;
}

bool isValidUsername(String value) => usernamePattern.hasMatch(value);

/// Applies [normalizeUsername] as the user types.
class UsernameInputFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    final normalized = normalizeUsername(newValue.text);
    if (normalized == newValue.text) return newValue;
    return TextEditingValue(
      text: normalized,
      selection: TextSelection.collapsed(offset: normalized.length),
    );
  }
}
