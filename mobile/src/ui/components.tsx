import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { type ReactNode, memo, useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  type PressableProps,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { create } from "zustand";
import { useNetwork } from "../state/network";
import { Text } from "./Text";
import { usePalette } from "./theme";

export type IconName = keyof typeof Ionicons.glyphMap;

export function Icon({ name, size = 22, color }: { name: IconName | string; size?: number; color?: string }) {
  const c = usePalette();
  return <Ionicons name={name as IconName} size={size} color={color ?? c.text} />;
}

// ---------------------------------------------------------------------------
// Avatar: profile/group photo with an initials fallback. expo-image caches on
// memory + disk, so avatars show instantly on relaunch and offline.
// ---------------------------------------------------------------------------

export const Avatar = memo(function Avatar({
  name,
  uri,
  size = 44,
  group = false,
}: {
  name: string;
  uri?: string | null;
  size?: number;
  group?: boolean;
}) {
  const cleaned = name.replace(/^@/, "").trim();
  const initials = cleaned ? cleaned.slice(0, 2).toUpperCase() : "?";
  const radius = { width: size, height: size, borderRadius: size / 2 };
  const fallback = (
    <View style={[radius, styles.avatarFallback]}>
      {group ? (
        <Ionicons name="people" size={size * 0.5} color="#fff" />
      ) : (
        <Text style={{ color: "#fff", fontWeight: "600", fontSize: size * 0.36 }} allowFontScaling={false}>
          {initials}
        </Text>
      )}
    </View>
  );
  if (!uri) return fallback;
  return (
    <View style={radius}>
      {fallback}
      <Image
        source={{ uri }}
        style={[StyleSheet.absoluteFill, radius]}
        cachePolicy="memory-disk"
        recyclingKey={uri}
        transition={120}
        contentFit="cover"
      />
    </View>
  );
});

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type ButtonProps = Omit<PressableProps, "style"> & {
  title: string;
  variant?: "filled" | "outline" | "text" | "danger" | "tonal";
  loading?: boolean;
  icon?: IconName;
  style?: ViewStyle;
  compact?: boolean;
};

export function Button({ title, variant = "filled", loading, icon, style, compact, disabled, ...props }: ButtonProps) {
  const c = usePalette();
  const off = disabled || loading;
  const bg =
    variant === "filled" ? c.primary : variant === "danger" ? c.error : variant === "tonal" ? `${c.primary}22` : "transparent";
  const fg = variant === "filled" || variant === "danger" ? "#fff" : variant === "outline" || variant === "text" ? c.primary : c.primary;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={off}
      {...props}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        { backgroundColor: bg, opacity: off ? 0.5 : pressed ? 0.8 : 1 },
        variant === "outline" && { borderWidth: 1, borderColor: c.primary },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={fg} style={{ marginRight: 6 }} /> : null}
          <Text style={{ color: fg, fontWeight: "600", fontSize: compact ? 14 : 15 }} numberOfLines={1}>
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  name,
  onPress,
  color,
  size = 24,
  label,
  disabled,
  filled,
}: {
  name: IconName;
  onPress?: () => void;
  color?: string;
  size?: number;
  label: string;
  disabled?: boolean;
  filled?: boolean;
}) {
  const c = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={({ pressed }) => [
        styles.iconButton,
        filled && { backgroundColor: c.primary },
        { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 },
      ]}
    >
      <Ionicons name={name} size={size} color={filled ? "#fff" : (color ?? c.text)} />
    </Pressable>
  );
}

export function Badge({ count, muted }: { count: number; muted?: boolean }) {
  const c = usePalette();
  if (count <= 0) return null;
  return (
    <View style={[styles.badge, { backgroundColor: muted ? c.muted : c.primary }]}>
      <Text style={styles.badgeText} allowFontScaling={false}>
        {count > 99 ? "99+" : count}
      </Text>
    </View>
  );
}

export function Spinner({ size = "small" }: { size?: "small" | "large" }) {
  const c = usePalette();
  return <ActivityIndicator color={c.primary} size={size} />;
}

export function Center({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }, style]}>{children}</View>;
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const c = usePalette();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: inset }} />;
}

export function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <Text muted style={styles.section}>
      {count == null ? title.toUpperCase() : `${title.toUpperCase()} · ${count}`}
    </Text>
  );
}

/** Inline error message (forms). */
export function ErrorText({ message }: { message: string | null }) {
  const c = usePalette();
  if (!message) return null;
  return (
    <View accessibilityLiveRegion="polite" style={[styles.error, { backgroundColor: `${c.error}22` }]}>
      <Text style={{ color: c.error, fontSize: 14 }}>{message}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Offline banner: a slim, non-blocking strip shown only while offline.
// ---------------------------------------------------------------------------

export function OfflineBanner({ message = "Offline — showing cached chats" }: { message?: string }) {
  const online = useNetwork((s) => s.online);
  const c = usePalette();
  if (online) return null;
  return (
    <View accessibilityLiveRegion="polite" style={[styles.offline, { backgroundColor: c.surfaceHighest }]}>
      <Ionicons name="cloud-offline-outline" size={15} color={c.muted} />
      <Text muted style={{ fontSize: 12.5, marginLeft: 8 }} numberOfLines={1}>
        {message}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Toast (snackbar)
// ---------------------------------------------------------------------------

const useToastStore = create<{ message: string | null; key: number }>(() => ({ message: null, key: 0 }));

export const toast = (message: string) => useToastStore.setState((s) => ({ message, key: s.key + 1 }));

export function ToastHost() {
  const { message, key } = useToastStore();
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!message) return;
    Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    const t = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() =>
        useToastStore.setState({ message: null }),
      );
    }, 2600);
    return () => clearTimeout(t);
  }, [key, message, opacity]);

  if (!message) return null;
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[styles.toast, { bottom: insets.bottom + 80, opacity, backgroundColor: c.dark ? "#2C2C2C" : "#27272A" }]}
    >
      <Text style={{ color: "#fff", fontSize: 14 }}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  avatarFallback: { alignItems: "center", justifyContent: "center", backgroundColor: "#F2602D" },
  button: {
    minHeight: 48,
    paddingHorizontal: 18,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonCompact: { minHeight: 34, paddingHorizontal: 14, borderRadius: 18 },
  iconButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#fff", fontSize: 11.5, fontWeight: "700" },
  section: { fontSize: 11.5, fontWeight: "700", letterSpacing: 0.6, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  error: { marginTop: 12, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  offline: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: 16, paddingVertical: 6 },
  toast: {
    position: "absolute",
    left: 16,
    right: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
});
