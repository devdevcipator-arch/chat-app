import { router } from "expo-router";
import { type ReactNode, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ProfileRepo } from "../../data/profiles";
import { Config } from "../../lib/config";
import { AppError, dbErrorMessage } from "../../lib/errors";
import { normalizeDisplayName } from "../../lib/username";
import { type ThemePreference, avatarImageUrl, profileName } from "../../models/types";
import { compressAvatar, pickPhoto } from "../../features/chat/attachments";
import { PUSH_COMPILED_IN, Push, usePushPref } from "../../services/push";
import { Auth, useAuth } from "../../state/auth";
import { Theme, useThemePref } from "../../state/theme";
import { Avatar, Button, Icon, IconButton, Spinner, toast } from "../../ui/components";
import { confirm, showActions } from "../../ui/sheets";
import { Text, TextInput } from "../../ui/Text";
import { usePalette, useScale } from "../../ui/theme";

const THEMES: { value: ThemePreference; label: string; icon: "sunny-outline" | "moon-outline" | "contrast-outline" }[] = [
  { value: "light", label: "Light", icon: "sunny-outline" },
  { value: "dark", label: "Dark", icon: "moon-outline" },
  { value: "system", label: "System", icon: "contrast-outline" },
];

export default function Settings() {
  const c = usePalette();
  const { s } = useScale();
  const insets = useSafeAreaInsets();
  const me = useAuth((st) => st.profile)!;
  const email = useAuth((st) => st.email);
  const themePref = useThemePref((st) => st.pref);
  const pushOn = usePushPref((st) => st.enabled);
  const [name, setName] = useState(me.displayName ?? "");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  const saveName = async () => {
    const next = normalizeDisplayName(name);
    if (next.length > Config.displayNameMax) return setNameError(`Use ${Config.displayNameMax} characters or fewer.`);
    setSavingName(true);
    setNameError(null);
    try {
      const updated = await ProfileRepo.updateDisplayName(me.id, next);
      Auth.setProfile({ ...me, displayName: updated.displayName });
      toast("Name saved");
    } catch (e) {
      setNameError(dbErrorMessage(e));
    } finally {
      setSavingName(false);
    }
  };

  const changePhoto = async (source: "camera" | "library") => {
    try {
      const asset = await pickPhoto(source);
      if (!asset) return;
      setPhotoBusy(true);
      const file = await compressAvatar(asset);
      const key = await ProfileRepo.uploadAvatar(file.uri, file.size ?? 0);
      Auth.setProfile({ ...me, avatarUrl: key });
      toast("Photo updated");
    } catch (e) {
      toast(e instanceof AppError ? e.message : e instanceof Error && e.message === "Permission denied." ? "Permission denied." : "Couldn't update your photo.");
    } finally {
      setPhotoBusy(false);
    }
  };

  const removePhoto = async () => {
    setPhotoBusy(true);
    try {
      await ProfileRepo.removeAvatar();
      Auth.setProfile({ ...me, avatarUrl: null });
      toast("Photo removed");
    } catch (e) {
      toast(e instanceof AppError ? e.message : "Couldn't remove your photo.");
    } finally {
      setPhotoBusy(false);
    }
  };

  const photoMenu = () =>
    showActions({
      actions: [
        { label: "Choose photo", icon: "images-outline", onPress: () => void changePhoto("library") },
        { label: "Take photo", icon: "camera-outline", onPress: () => void changePhoto("camera") },
        ...(me.avatarUrl ? [{ label: "Remove photo", icon: "trash-outline" as const, destructive: true, onPress: () => void removePhoto() }] : []),
      ],
    });

  const setTheme = async (pref: ThemePreference) => {
    try {
      await Theme.choose(pref, me.id);
      Auth.setProfile({ ...me, theme: pref });
    } catch {
      toast("Couldn't save your theme. Please try again.");
    }
  };

  const signOut = async () => {
    const ok = await confirm(
      "Sign out of your account?",
      "You'll need to sign in again with your email to use the app on this device. Saved chats on this device are removed.",
      "Sign out",
    );
    // Removes the session (offline too), hangs up any call and wipes the local cache.
    if (ok) await Auth.signOut();
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ padding: s(16), paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: "center", marginTop: s(8) }}>
          <Pressable onPress={photoMenu} disabled={photoBusy} accessibilityRole="button" accessibilityLabel="Change photo">
            <Avatar name={profileName(me)} uri={avatarImageUrl(me)} size={s(104)} />
            {photoBusy ? (
              <View style={[StyleSheet.absoluteFill, styles.center, { borderRadius: 999, backgroundColor: c.overlay }]}>
                <Spinner />
              </View>
            ) : null}
            <View style={[styles.camera, { backgroundColor: c.primary, borderColor: c.bg }]}>
              <Icon name="camera" size={16} color="#fff" />
            </View>
          </Pressable>
          <Text style={{ fontSize: 17, fontWeight: "600", marginTop: 10 }}>@{me.username}</Text>
          {email ? (
            <Text muted style={{ fontSize: 13, marginTop: 2 }}>
              {email}
            </Text>
          ) : null}
        </View>

        <Section title="Profile">
          <View style={[styles.field, { borderColor: nameError ? c.error : c.border, backgroundColor: c.surface }]}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Display name"
              maxLength={Config.displayNameMax}
              autoCapitalize="words"
              returnKeyType="done"
              onSubmitEditing={saveName}
              style={{ flex: 1, height: "100%", fontSize: 16 }}
              accessibilityLabel="Display name"
            />
            {savingName ? <Spinner /> : <IconButton name="checkmark" label="Save name" color={c.primary} onPress={saveName} />}
          </View>
          <Text style={{ fontSize: 12.5, marginTop: 6, color: nameError ? c.error : c.muted }}>
            {nameError ?? "Leave empty to show your @username."}
          </Text>
          <Row icon="images-outline" title="Gallery" subtitle="Your saved photos, videos and files" onPress={() => router.push("/gallery")} />
        </Section>

        <Section title="Appearance">
          <View style={[styles.segment, { backgroundColor: c.surface }]}>
            {THEMES.map((t) => {
              const active = t.value === themePref;
              return (
                <Pressable
                  key={t.value}
                  onPress={() => void setTheme(t.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  style={[styles.segmentItem, active && { backgroundColor: c.primary }]}
                >
                  <Icon name={t.icon} size={17} color={active ? "#fff" : c.text} />
                  <Text style={{ marginLeft: 6, color: active ? "#fff" : c.text, fontWeight: active ? "600" : "400" }}>{t.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </Section>

        <Section title="Notifications">
          <View style={[styles.rowCard, { backgroundColor: c.surface }]}>
            <Icon name="notifications-outline" />
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={{ fontSize: 16 }}>Push notifications</Text>
              <Text muted style={{ fontSize: 12.5, marginTop: 2 }}>
                {PUSH_COMPILED_IN
                  ? "New messages and incoming calls, even when the app is closed."
                  : "New messages and incoming calls while the app is open or in the background."}
              </Text>
            </View>
            <Switch
              value={pushOn}
              onValueChange={(v) => void Push.setEnabled(me.id, v)}
              trackColor={{ true: c.primary, false: c.surfaceHighest }}
              thumbColor="#fff"
              accessibilityLabel="Push notifications"
            />
          </View>
        </Section>

        <Section title="Account">
          <Button title="Sign Out" icon="log-out-outline" variant="outline" onPress={signOut} style={{ borderColor: c.error }} />
        </Section>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ marginTop: 28 }}>
      <Text muted style={{ fontSize: 13, fontWeight: "600", marginBottom: 8 }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function Row({ icon, title, subtitle, onPress }: { icon: "images-outline"; title: string; subtitle: string; onPress: () => void }) {
  const c = usePalette();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.rowCard, { backgroundColor: pressed ? c.surfaceHigh : c.surface, marginTop: 12 }]}
    >
      <Icon name={icon} />
      <View style={{ flex: 1, marginLeft: 14 }}>
        <Text style={{ fontSize: 16 }}>{title}</Text>
        <Text muted style={{ fontSize: 12.5, marginTop: 2 }}>
          {subtitle}
        </Text>
      </View>
      <Icon name="chevron-forward" color={c.muted} size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
  camera: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  field: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, paddingLeft: 14, paddingRight: 4, height: 52 },
  segment: { flexDirection: "row", borderRadius: 12, padding: 4 },
  segmentItem: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", height: 40, borderRadius: 9 },
  rowCard: { flexDirection: "row", alignItems: "center", borderRadius: 14, padding: 14 },
});
