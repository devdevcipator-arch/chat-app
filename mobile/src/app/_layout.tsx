import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { lazy, Suspense } from "react";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { isConfigured } from "../lib/config";
import { Auth, useAuth } from "../state/auth";
import { useCall } from "../state/calls";
import { startSession } from "../state/session";
import { Button, Center, Spinner, ToastHost } from "../ui/components";
import { SheetHost } from "../ui/sheets";
import { Text } from "../ui/Text";
import { usePalette } from "../ui/theme";

// Hydrate every store from MMKV before the first frame (0 ms, no spinners).
if (isConfigured) startSession();

// The call UI (and with it react-native-agora) loads only once a call exists.
const CallOverlay = lazy(() => import("../calls/CallOverlay"));

export default function RootLayout() {
  const c = usePalette();
  const stage = useAuth((s) => s.stage);
  const callActive = useCall((s) => s.phase !== "idle");

  const base = c.dark ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: { ...base.colors, primary: c.primary, background: c.bg, card: c.bg, text: c.text, border: c.border },
  };

  return (
    <SafeAreaProvider>
      <ThemeProvider value={navTheme}>
        <StatusBar style={c.dark ? "light" : "dark"} />
        <View style={{ flex: 1, backgroundColor: c.bg }}>
          {!isConfigured ? (
            <Center>
              <Text style={{ textAlign: "center" }}>
                Missing Supabase configuration.{"\n\n"}Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.
              </Text>
            </Center>
          ) : stage === "loading" ? (
            <Center>
              <Spinner size="large" />
            </Center>
          ) : stage === "error" ? (
            <ErrorScreen />
          ) : (
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
              <Stack.Protected guard={stage === "ready"}>
                <Stack.Screen name="(app)" />
              </Stack.Protected>
              <Stack.Protected guard={stage === "onboarding"}>
                <Stack.Screen name="onboarding" />
              </Stack.Protected>
              <Stack.Protected guard={stage === "signedOut"}>
                <Stack.Screen name="sign-in" />
              </Stack.Protected>
            </Stack>
          )}
          {callActive ? (
            <Suspense fallback={null}>
              <CallOverlay />
            </Suspense>
          ) : null}
          <SheetHost />
          <ToastHost />
        </View>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function ErrorScreen() {
  const error = useAuth((s) => s.error);
  return (
    <Center>
      <Text style={{ textAlign: "center", marginBottom: 16 }}>{error ?? "Something went wrong."}</Text>
      <Button title="Try again" onPress={Auth.retry} />
      <Button title="Sign out" variant="text" onPress={() => void Auth.signOut()} style={{ marginTop: 8 }} />
    </Center>
  );
}
