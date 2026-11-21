import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { unreadOf, useChats } from "../../../state/chats";
import { useMissedCalls } from "../../../state/missedCalls";
import { usePalette } from "../../../ui/theme";

/** Icon + label area of the tab bar, in dp (fits a 24 dp icon and a 15 dp label line). */
const TAB_CONTENT = 54;

const badge = (n: number) => (n > 0 ? (n > 99 ? "99+" : n) : undefined);

/** Chats / Groups / Calls, each with a numeric badge (unmuted conversations only). */
export default function TabsLayout() {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const chats = useChats((st) => st.chats);
  const openChatId = useChats((st) => st.openChatId);
  const missed = useMissedCalls((st) => st.count);
  // Sit fully above Android's 3-button bar / gesture pill (and the iOS home
  // indicator) with a visible gap, never touching it. The icon + label area is
  // NOT scaled down on narrow phones: at 360 dp, s(58) left ~45 dp, too little
  // for icon + label, so the labels spilled into the padding under the system bar.
  const bottom = insets.bottom + 8;

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
          height: TAB_CONTENT + 6 + bottom,
          paddingTop: 6,
          // Overrides the bar's own inset padding, so it's applied exactly once.
          paddingBottom: bottom,
        },
        tabBarLabelStyle: { fontSize: 11.5, fontWeight: "600", lineHeight: 15, marginTop: 2 },
        tabBarItemStyle: { height: TAB_CONTENT, paddingVertical: 2 },
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
            <Ionicons name={focused ? "chatbubble" : "chatbubble-outline"} size={23} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="groups"
        options={{
          title: "Groups",
          tabBarBadge: badge(groupUnread),
          tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? "people" : "people-outline"} size={24} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="calls"
        options={{
          title: "Calls",
          tabBarBadge: badge(missed),
          tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? "call" : "call-outline"} size={22} color={color as string} />,
        }}
      />
    </Tabs>
  );
}
