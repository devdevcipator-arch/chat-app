# R8 keep rules for the release build (isMinifyEnabled = true).
# Anything reached only through JNI or reflection must be kept here, or the
# release APK crashes at runtime while debug builds work fine.

# Agora RTC SDK (accessed via JNI / reflection)
-keep class io.agora.** { *; }
-dontwarn io.agora.**

# Flutter engine and embedding (plugin registrant is looked up reflectively)
-keep class io.flutter.** { *; }
-keep class io.flutter.plugins.** { *; }
-keep class io.flutter.plugin.** { *; }
-keep class io.flutter.embedding.** { *; }
-dontwarn io.flutter.embedding.**
# Deferred components / Play Core are referenced by the engine but not used.
-dontwarn com.google.android.play.core.**

# Supabase is pure Dart; keep the native pieces its plugins use
# (app_links for auth deep links, shared_preferences, path_provider).
-keep class com.llfbandit.app_links.** { *; }
-keep class io.flutter.plugins.sharedpreferences.** { *; }
-keep class io.flutter.plugins.pathprovider.** { *; }

# Media / recording / permissions plugins (JNI + reflection)
-keep class com.ryanheise.just_audio.** { *; }
-keep class com.llfbandit.record.** { *; }
-keep class com.baseflow.permissionhandler.** { *; }
-keep class androidx.media3.** { *; }
-dontwarn androidx.media3.**

# Native method names must survive obfuscation.
-keepclasseswithmembernames class * {
    native <methods>;
}

# Keep annotations / generic signatures (used by reflection-based libraries).
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod
