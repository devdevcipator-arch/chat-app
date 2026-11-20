import { Stack } from "expo-router";
import { usePalette } from "../../ui/theme";

/**
 * Signed-in navigation. Conversations and other detail screens are pushed on
 * this stack *above* the tabs, so the bottom bar is hidden while a chat is open.
 */
export default function AppLayout() {
  const c = usePalette();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: c.bg },
        headerTintColor: c.text,
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: "600" },
        contentStyle: { backgroundColor: c.bg },
        headerBackButtonDisplayMode: "minimal",
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="chat/[id]" options={{ title: "" }} />
      <Stack.Screen name="group-info/[id]" options={{ title: "Group info" }} />
      <Stack.Screen name="new-group" options={{ title: "New group" }} />
      <Stack.Screen name="settings" options={{ title: "Settings" }} />
      <Stack.Screen name="gallery" options={{ title: "Gallery" }} />
      <Stack.Screen name="viewer" options={{ headerShown: false, presentation: "fullScreenModal", animation: "fade" }} />
      <Stack.Screen name="gallery-item" options={{ headerShown: false, presentation: "fullScreenModal", animation: "fade" }} />
      <Stack.Screen name="forward" options={{ title: "Send to…", presentation: "modal" }} />
    </Stack>
  );
}
