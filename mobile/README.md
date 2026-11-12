# Mobile (Flutter)

Native Android/iOS client for the same Supabase backend and web platform
(`chat.devcipator.com`): email OTP sign-in → @username onboarding → chats.

Features, matching the web app:
- **Messaging:** text, photos, voice notes (recorder + custom player), videos,
  documents/audio files, voicemails; realtime delivery, retry on failure.
- **Editing:** your own text messages within 10 minutes (`edit_message`), shown as "(edited)".
- **Groups:** create, rename, add/remove members, admin roles, group info,
  message a member directly; mute/unmute, clear chat, delete/leave, unread badges.
- **Calls:** 1-on-1 and group voice/video over Agora, signaled through the
  `calls` / `call_participants` RPCs; voicemail after an unanswered call.
- **Profile & appearance:** display name, profile photo, Light / Dark / System
  theme (synced via `profiles.theme_preference`).
- **Gallery (vault):** upload, preview, delete, and send items to any chat.

```
lib/
  main.dart                 Supabase.initialize + config check
  app.dart                  MaterialApp, theme, AuthGate routing, call overlay
  core/                     config, API client (Bearer auth), media rules, theme, errors
  data/                     Chat/Profile/Gallery/Call repositories (RLS-scoped)
  services/                 CallController (signaling + Agora engine)
  models/                   Profile, ChatSummary, ChatDetails, ChatMessage, GalleryItem
  screens/                  login, onboarding, chat list, chat, group info, new group,
                            settings, gallery, call
  widgets/                  avatar, audio player, voice recorder, media viewers, member picker
```

## How it talks to the backend
- **Supabase** (database, RPCs, Realtime) directly with the publishable key; RLS
  protects everything.
- **Web API** (`API_BASE_URL`) for anything needing server secrets: presigned R2
  uploads (`/api/media/upload-url`, `/api/gallery/*`, `/api/profile/avatar*`)
  and Agora tokens (`/api/agora/token`). The app sends the Supabase access token
  as `Authorization: Bearer …`; the routes verify it (see
  `web/src/lib/supabase/server.ts` → `getApiAuth`). The Agora App ID comes back
  with each token, so no Agora keys live in the app.

## Requirements
Flutter ≥ 3.35 (Dart ≥ 3.9), Android SDK (via Android Studio) for APK builds.
Android minSdk is 24.

## Configuration
`env.json` (gitignored) — copy `env.example.json`:

| Key | What |
| --- | --- |
| `SUPABASE_URL` | Project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Publishable (anon) key |
| `API_BASE_URL` | Web platform, default `https://chat.devcipator.com` |
| `R2_PUBLIC_BASE` | Public R2 domain media keys resolve against (same as the web's `NEXT_PUBLIC_R2_PUBLIC_DOMAIN`) |

## Run / build
```powershell
cd mobile
flutter pub get
flutter analyze
flutter test
flutter run --dart-define-from-file=env.json
flutter build apk --debug --dart-define-from-file=env.json
flutter build apk --split-per-abi --dart-define-from-file=env.json   # release
```
APKs land in `build/app/outputs/flutter-apk/` — for most phones install
`app-arm64-v8a-release.apk`. Release builds are signed with the debug key
(fine for testing; set up a release keystore before publishing).

## Known limits
- Incoming calls ring only while the app is open (no push notifications /
  background call service yet).
