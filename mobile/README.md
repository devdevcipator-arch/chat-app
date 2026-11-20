# Mobile (Expo / React Native)

Native Android/iOS client for the same Supabase backend and web platform
(`chat.devcipator.com`): email OTP sign-in → @username onboarding → chats.
Expo SDK 58, React Native 0.88 (New Architecture + Hermes), TypeScript, Expo Router.

The previous Flutter app is preserved in git history at the tag `flutter-final`.

## Features (parity with the Flutter app and the web)
- **Auth:** 6-digit email OTP; the session lives in MMKV and survives offline launches.
  Only an explicit Sign Out (or the server rejecting the refresh token) returns to Sign-In.
- **Tabs:** Chats (direct + groups, newest first), Groups (groups only), Calls (date + time,
  missed/declined in red, one-tap redial). Numeric badges count unmuted conversations; the Calls
  badge counts unseen missed/declined calls since `last_seen_calls_at` (device-local) and clears
  when the tab opens. The tab bar hides while a conversation is open.
- **Search (always visible):** instant local search over chats and groups, exact `@username`
  lookup (`find_profile_by_username`), Discover Groups (`search_groups`) + Join (`join_group`).
- **Messages:** text, photos, voice notes (Pause/Resume, live waveform), voicemail, video,
  documents of any format (EPUB, PDF, ZIP, …; `application/octet-stream` resolved by extension)
  via `/api/media/upload-url` → R2. 10-minute edits (`edit_message`) shown as "(edited)".
  `/math` calculator (same evaluator as the web). Call receipts with date and time.
- **Groups:** create, Group Info (admins/members, rename, add/remove, promote/demote, message a
  member), mute/unmute, clear chat, delete/leave.
- **Gallery (vault):** upload (`/api/gallery/upload-url`), preview, permanent delete (R2 + row),
  forward in two steps (pick a chat → Send).
- **Settings:** display name, avatar upload/remove, Light/Dark/System (synced to
  `profiles.theme_preference`), push notifications toggle, Sign Out (confirmed; wipes the cache).
- **Calls:** Agora voice/video, 1-on-1 and group, signaled via `start_call` / `answer_call` /
  `end_call` / `heartbeat_call`; tokens from `/api/agora/token`. `react-native-agora` is loaded
  lazily (only when a call connects).

## Architecture
```
index.ts                 registers headless push handlers, then expo-router/entry
app.config.ts            app config (ids, permissions, build properties, conditional push)
plugins/withAndroidRelease.js   ABI splits, per-ABI versionCodes, release signing, packaging
src/app/                 routes (Expo Router): sign-in, onboarding, (app)/(tabs)/{index,groups,calls},
                         (app)/chat/[id], group-info/[id], new-group, settings, gallery, gallery-item,
                         forward, viewer
src/state/               zustand stores: auth, chats, messages (optimistic + outbox), realtime (ONE
                         multiplexed channel), calls (Agora state machine), missedCalls, network, theme
src/data/                Supabase/REST repositories + MMKV cache + R2 uploads
src/features/            chat list, chat bubbles/composer/recorder/audio, member picker, video
src/calls/CallOverlay    full-screen call UI (lazy)
src/services/            push (FCM) + Notifee full-screen incoming-call notification (optional)
src/lib/                 config, api client, errors, media rules, math (copied from web), formatting
```

**Local-first:** every store hydrates synchronously from MMKV before the first frame, then syncs
in the background; a slim "Offline — showing cached chats" banner appears when offline. Sends are
optimistic (clock icon) and queued in a persistent outbox that flushes on reconnect; client UUIDs
make retries idempotent.

## How it talks to the backend (unchanged)
- **Supabase** directly with the publishable key; RLS protects everything. Realtime uses a single
  channel `app:<userId>` (messages, my chat_participants rows, calls).
- **Web API** (`EXPO_PUBLIC_API_BASE_URL`) with `Authorization: Bearer <supabase access token>`:
  `/api/media/upload-url`, `/api/gallery*`, `/api/profile/avatar*`, `/api/agora/token`.

## Configuration
`.env` (gitignored), copy `.env.example`:

| Key | What |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | Project URL |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable (anon) key |
| `EXPO_PUBLIC_API_BASE_URL` | Web platform, default `https://chat.devcipator.com` |
| `EXPO_PUBLIC_R2_PUBLIC_BASE` | Public R2 domain media keys resolve against |

CI writes `.env` from the existing GitHub Secrets (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
`API_BASE_URL`, `R2_PUBLIC_BASE`) and signs with `ANDROID_KEYSTORE_BASE64` + `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD`, `ANDROID_STORE_PASSWORD`.

## Push notifications / lock-screen calls (optional)
Compiled in only when `google-services.json` (Android, secret `GOOGLE_SERVICES_JSON`) or
`GoogleService-Info.plist` (iOS, secret `GOOGLE_SERVICE_INFO_PLIST`) is present at build time.
The backend side does **not** exist yet; it needs:
- table `user_push_tokens(user_id uuid, token text unique, platform text, updated_at timestamptz)`
- column `profiles.push_notifications_enabled boolean`
- a sender (e.g. an edge function on `calls` inserts) posting FCM data messages
  `{ type: "call", call_id, chat_id, caller_name, call_type }` / `{ type: "call_ended", call_id }`.

Until then the toggle is stored and the token writes fail silently.

## Run / build
```bash
cd mobile
npm install
npx tsc --noEmit
npx expo run:android          # dev build on a device/emulator
npm run build:android         # release APKs → android/app/build/outputs/apk/release/
```
Release APKs: `app-arm64-v8a-release.apk` (published as `chat-app.apk`) and
`app-armeabi-v7a-release.apk` (`chat-app-32bit.apk`). Version codes follow the Flutter scheme
(arm64 = 2000 + build number), so they install as updates over the Flutter app. Users sign in
once after that update (the Flutter session store can't be read by the new app).
