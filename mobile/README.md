# Mobile (Flutter)

First-time setup (generates android/, ios/, web/ … without touching lib/ or pubspec.yaml):

    flutter create . --org com.chatapp --project-name chat_app
    flutter pub get

Run:

    flutter run --dart-define=SUPABASE_URL=https://<ref>.supabase.co --dart-define=SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
