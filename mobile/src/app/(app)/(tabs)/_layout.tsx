import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { unreadOf, useChats } from "../../../state/chats";
import { useMissedCalls } from "../../../state/missedCalls";
import { usePalette, useScale } from "../../../ui/theme";

const badge = (n: number) => (n > 0 ? (n > 99 ? "99+" : n) : undefined);

/** Chats / Groups / Calls, each with a numeric badge (unmuted conversations only). */
export default function TabsLayout() {
  const c = usePalette();
  const { s } = useScale();
  const insets = useSafeAreaInsets();
  const chats = useChats((st) => st.chats);
  const openChatId = useChats((st) => st.openChatId);
  const missed = useMissedCalls((st) => st.count);

  const allUnread = unreadOf(chats, openChatId);
  const groupUnread = unreadOf(
    chats.filter((ch) => ch.type === "group"),
    openChatId,
  );

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.muted,
        tabBarStyle: {
          backgroundColor: c.bg,
          borderTopColor: c.border,
          height: s(58) + insets.bottom,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11.5, fontWeight: "600" },
        tabBarAllowFontScaling: false,
        tabBarBadgeStyle: { backgroundColor: c.primary, color: "#fff", fontSize: 11 },
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Chats",
          tabBarBadge: badge(allUnread),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "chatbubble" : "chatbubble-outline"} size={23} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="groups"
        options={{
          title: "Groups",
          tabBarBadge: badge(groupUnread),
          tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? "people" : "people-outline"} size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="calls"
        options={{
          title: "Calls",
          tabBarBadge: badge(missed),
          tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? "call" : "call-outline"} size={22} color={color} />,
        }}
      />
    </Tabs>
  );
}
