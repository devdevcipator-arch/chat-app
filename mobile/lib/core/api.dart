import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import 'config.dart';
import 'supabase.dart';

/// A failure with a message that can be shown to the user as is.
class ApiException implements Exception {
  const ApiException(this.message, {this.status});
  final String message;
  final int? status;

  @override
  String toString() => message;
}

/// Calls the web platform's API routes (/api/...) as the signed-in user.
///
/// Native apps have no session cookie, so the Supabase access token is sent
/// as `Authorization: Bearer`; the routes verify it and run queries under RLS.
abstract final class Api {
  static final _client = http.Client();

  static Uri _uri(String path) => Uri.parse('${AppConfig.apiBaseUrl}$path');

  static Future<Map<String, String>> _headers({bool json = true}) async {
    var session = supabase.auth.currentSession;
    if (session == null) throw const ApiException('Please sign in again.', status: 401);
    if (session.isExpired) {
      try {
        session = (await supabase.auth.refreshSession()).session ?? session;
      } catch (_) {
        // Fall through with the old token; the server answers 401 if it's dead.
      }
    }
    return {
      'Authorization': 'Bearer ${session!.accessToken}',
      if (json) 'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }

  static Future<Map<String, dynamic>> post(String path, Map<String, Object?> body) =>
      _send('POST', path, body);

  static Future<Map<String, dynamic>> put(String path, Map<String, Object?> body) =>
      _send('PUT', path, body);

  static Future<Map<String, dynamic>> delete(String path) => _send('DELETE', path, null);

  static Future<Map<String, dynamic>> _send(String method, String path, Map<String, Object?>? body) async {
    final request = http.Request(method, _uri(path))..headers.addAll(await _headers(json: body != null));
    if (body != null) request.body = jsonEncode(body);

    http.Response response;
    try {
      response = await http.Response.fromStream(
        await _client.send(request).timeout(const Duration(seconds: 30)),
      );
    } on TimeoutException {
      throw const ApiException('The server took too long to answer. Please try again.');
    } on SocketException {
      throw const ApiException("Can't reach the server. Check your connection.");
    } on http.ClientException {
      throw const ApiException("Can't reach the server. Check your connection.");
    }

    Map<String, dynamic>? data;
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map<String, dynamic>) data = decoded;
    } catch (_) {
      // Non-JSON body (e.g. a proxy error page).
    }
    if (response.statusCode >= 200 && response.statusCode < 300) return data ?? const {};
    final error = data?['error'];
    throw ApiException(
      error is String && error.isNotEmpty ? error : 'Something went wrong (${response.statusCode}).',
      status: response.statusCode,
    );
  }

  /// PUTs a local file to a presigned R2 URL, reporting progress 0–1.
  /// [headers] are part of the signature and must be sent exactly.
  static Future<void> uploadFile({
    required String uploadUrl,
    required Map<String, String> headers,
    required File file,
    required int length,
    void Function(double fraction)? onProgress,
  }) async {
    final request = http.StreamedRequest('PUT', Uri.parse(uploadUrl))
      ..headers.addAll(headers)
      ..contentLength = length;

    var sent = 0;
    unawaited(() async {
      try {
        await for (final chunk in file.openRead()) {
          request.sink.add(chunk);
          sent += chunk.length;
          onProgress?.call(length == 0 ? 1 : sent / length);
        }
      } finally {
        await request.sink.close();
      }
    }());

    http.StreamedResponse response;
    try {
      response = await _client.send(request).timeout(const Duration(minutes: 5));
    } on TimeoutException {
      throw const ApiException('Upload timed out. Please try again.');
    } on SocketException {
      throw const ApiException('Upload failed. Check your connection.');
    } on http.ClientException {
      throw const ApiException('Upload failed. Check your connection.');
    }
    await response.stream.drain<void>();
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ApiException('Upload failed (${response.statusCode}). Please try again.');
    }
  }
}

/// Header map from a JSON object of strings.
Map<String, String> stringMap(Object? value) => value is Map
    ? {for (final e in value.entries) '${e.key}': '${e.value}'}
    : const {};
