# Mobile (Flutter)

Same flow as the web app: email OTP sign-in → @username onboarding → chat list
(search by exact @username, start chat) → 1-on-1 chat with Supabase Realtime.

```
lib/
  main.dart                 Supabase.initialize + config check
  app.dart                  MaterialApp + AuthGate (login / onboarding / chats routing)
  core/                     config, Supabase accessor, errors, username rules, ids, time
  data/                     ProfileRepository, ChatRepository (all calls run under RLS)
  models/                   Profile, ChatSummary, ChatMessage
  screens/                  login, onboarding, chat list, chat
  widgets/                  avatar, OTP field, form helpers
```

## Requirements
Flutter ≥ 3.35 (Dart ≥ 3.9), Android SDK (via Android Studio) for APK builds.

## First-time setup
```powershell
powershell -ExecutionPolicy Bypass -File mobile\tool\setup.ps1
```
This runs `flutter create` (adds `android/`, `ios/` without touching `lib/`),
adds the INTERNET permission needed by release builds, and runs `flutter pub get`.

`env.json` (gitignored) holds the Supabase URL and publishable key. Copy
`env.example.json` if it's missing.

## Run / build
```powershell
cd mobile
flutter analyze
flutter test
flutter run --dart-define-from-file=env.json
flutter build apk --split-per-abi --dart-define-from-file=env.json
```
APKs land in `build/app/outputs/flutter-apk/` — for most phones install
`app-arm64-v8a-release.apk`. Release builds are signed with the debug key
(fine for testing; set up a release keystore before publishing).
