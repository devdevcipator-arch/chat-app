import fs from "node:fs";
import path from "node:path";
import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * Push (FCM) + lock-screen call ringing is compiled in only when a Firebase
 * config is present at build time (CI writes it from the GOOGLE_SERVICES_JSON
 * secret). Without it the native Firebase/Notifee code is left out entirely
 * (see react-native.config.js), which keeps the APK smaller and the build
 * independent of a Firebase project.
 */
const GOOGLE_SERVICES = path.join(__dirname, "google-services.json");
const GOOGLE_SERVICE_INFO = path.join(__dirname, "GoogleService-Info.plist");
const pushAndroid = fs.existsSync(GOOGLE_SERVICES);
const pushIos = fs.existsSync(GOOGLE_SERVICE_INFO);
const pushEnabled = pushAndroid || pushIos;

/** CI passes the workflow run number; the release plugin turns it into per-ABI version codes. */
const buildNumber = Number.parseInt(process.env.BUILD_NUMBER ?? "1", 10) || 1;

const PROGUARD_RULES = `
# Agora RTC SDK (JNI + reflection)
-keep class io.agora.** { *; }
-dontwarn io.agora.**
# MMKV / Nitro modules (JNI)
-keep class com.margelo.** { *; }
-keep class com.tencent.mmkv.** { *; }
# Firebase / Notifee (only present when push is compiled in)
-keep class io.invertase.** { *; }
-keep class app.notifee.** { *; }
-dontwarn app.notifee.**
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**
# Local Expo module (found by name at runtime).
-keep class expo.modules.calllockscreen.** { *; }
# Native method names must survive obfuscation.
-keepclasseswithmembernames class * { native <methods>; }
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod
`;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Chat App",
  slug: "chat-app",
  scheme: "chatapp",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  backgroundColor: "#0A0A0A",
  // React Native 0.88 runs only on the New Architecture (there is no switch
  // any more); Hermes is the JS engine.
  jsEngine: "hermes",
  // Brand logo (assets/*.png are generated from the source logo, white removed).
  splash: { image: "./assets/splash-icon.png", resizeMode: "contain", backgroundColor: "#FFFFFF" },
  ios: {
    bundleIdentifier: "com.devcipator.chatApp",
    buildNumber: String(buildNumber),
    supportsTablet: false,
    ...(pushIos ? { googleServicesFile: "./GoogleService-Info.plist" } : {}),
    infoPlist: {
      CFBundleDisplayName: "Chat App",
      NSCameraUsageDescription: "Chat App uses the camera for video calls and to take photos and videos to share in chats.",
      NSMicrophoneUsageDescription: "Chat App uses the microphone for voice and video calls and to record voice messages.",
      NSPhotoLibraryUsageDescription:
        "Chat App needs access to your photo library so you can share photos and videos and set a profile picture.",
      NSPhotoLibraryAddUsageDescription: "Chat App saves photos and videos you download from chats to your photo library.",
      // Calls keep their audio when the app goes to the background.
      UIBackgroundModes: ["audio", ...(pushIos ? ["voip", "remote-notification"] : [])],
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    // Kept identical to the Flutter app so this APK updates existing installs.
    package: "com.devcipator.chat_app",
    versionCode: buildNumber,
    adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: "#FFFFFF" },
    softwareKeyboardLayoutMode: "resize",
    ...(pushAndroid ? { googleServicesFile: "./google-services.json" } : {}),
    permissions: [
      "android.permission.INTERNET",
      "android.permission.ACCESS_NETWORK_STATE",
      "android.permission.ACCESS_WIFI_STATE",
      "android.permission.RECORD_AUDIO",
      "android.permission.MODIFY_AUDIO_SETTINGS",
      "android.permission.CAMERA",
      "android.permission.BLUETOOTH_CONNECT",
      "android.permission.WAKE_LOCK",
      // Ringing (Vibration API) and local notifications for messages / calls.
      "android.permission.VIBRATE",
      "android.permission.POST_NOTIFICATIONS",
      // Killed-state call ringing (only in builds with Firebase).
      ...(pushAndroid
        ? [
            "android.permission.USE_FULL_SCREEN_INTENT",
            "android.permission.FOREGROUND_SERVICE",
            "android.permission.SYSTEM_ALERT_WINDOW",
          ]
        : []),
    ],
    blockedPermissions: [
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      ...(pushAndroid ? [] : ["android.permission.SYSTEM_ALERT_WINDOW"]),
      "android.permission.READ_PHONE_STATE",
    ],
  },
  plugins: [
    "expo-router",
    [
      "expo-build-properties",
      {
        android: {
          minSdkVersion: 24,
          enableMinifyInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
          extraProguardRules: PROGUARD_RULES,
          useLegacyPackaging: true,
        },
        ios: pushIos ? { useFrameworks: "static" } : {},
      },
    ],
    [
      "expo-audio",
      { microphonePermission: "Chat App uses the microphone for voice and video calls and to record voice messages." },
    ],
    [
      "expo-image-picker",
      {
        photosPermission: "Chat App needs access to your photo library so you can share photos and videos and set a profile picture.",
        cameraPermission: "Chat App uses the camera for video calls and to take photos and videos to share in chats.",
        microphonePermission: "Chat App uses the microphone to record videos.",
      },
    ],
    "expo-video",
    // Local notifications (no Firebase needed), see src/services/localNotifications.ts.
    // White silhouette for the status bar; tinted with the logo orange.
    ["expo-notifications", { icon: "./assets/notification-icon.png", color: "#FF4D2E" }],
    "./plugins/withAndroidRelease",
    ...(pushEnabled ? ["@react-native-firebase/app", "@react-native-firebase/messaging"] : []),
  ],
  extra: { pushEnabled },
});
