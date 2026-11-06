import 'package:supabase_flutter/supabase_flutter.dart';

/// The app-wide Supabase client (available after `Supabase.initialize`).
SupabaseClient get supabase => Supabase.instance.client;
