import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ProfileRepo } from "../data/profiles";
import { Config } from "../lib/config";
import { dbErrorMessage } from "../lib/errors";
import { isValidUsername, normalizeUsername } from "../lib/username";
import { Auth, useAuth } from "../state/auth";
import { Button, ErrorText, Icon, Spinner } from "../ui/components";
import { Text, TextInput } from "../ui/Text";
import { usePalette, useScale } from "../ui/theme";

type Availability = "idle" | "invalid" | "checking" | "available" | "taken" | "error";

/** First-run identity setup: unique @username + optional display name. */
export default function Onboarding() {
  const c = usePalette();
  const { s } = useScale();
  const userId = useAuth((st) => st.userId)!;
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [availability, setAvailability] = useState<Availability>("idle");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef("");

  useEffect(() => {
    latest.current = username;
    setError(null);
    if (!username) return setAvailability("idle");
    if (!isValidUsername(username)) return setAvailability("invalid");
    setAvailability("checking");
    const t = setTimeout(async () => {
      let result: Availability;
      try {
        const match = await ProfileRepo.findByUsername(username);
        result = !match || match.id === userId ? "available" : "taken";
      } catch {
        result = "error";
      }
      if (latest.current === username) setAvailability(result); // ignore stale responses
    }, 400);
    return () => clearTimeout(t);
  }, [username, userId]);

  const canSubmit = !pending && isValidUsername(username) && availability !== "taken" && availability !== "checking";

  const submit = async () => {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      const profile = await ProfileRepo.completeOnboarding(userId, username, displayName);
      setDone(true);
      setTimeout(() => Auth.setProfile(profile), 800);
    } catch (e) {
      setPending(false);
      if ((e as { code?: string }).code === "23505") setAvailability("taken");
      setError(dbErrorMessage(e));
    }
  };

  const [hint, hintColor] = {
    idle: ["3–20 characters: lowercase letters, numbers, underscores.", c.muted],
    invalid: ["3–20 characters: lowercase letters, numbers, underscores.", c.warning],
    checking: ["Checking availability…", c.muted],
    available: ["Available", c.success],
    taken: ["That username is taken.", c.error],
    error: ["Couldn't check right now. You can still try to continue.", c.warning],
  }[availability];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={styles.topBar}>
        <Button title="Sign out" variant="text" compact disabled={pending} onPress={() => void Auth.signOut()} />
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={[styles.container, { padding: s(24) }]} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            {done ? (
              <View style={{ alignItems: "center" }}>
                <View style={[styles.check, { backgroundColor: c.success }]}>
                  <Icon name="checkmark" size={32} color="#fff" />
                </View>
                <Text style={{ fontSize: 17, fontWeight: "600" }}>You're all set, @{username}</Text>
                <Text muted style={{ marginTop: 4 }}>
                  Opening your chats…
                </Text>
              </View>
            ) : (
              <>
                <Text style={[styles.title, { fontSize: s(24) }]}>Choose your identity</Text>
                <Text muted style={{ marginBottom: 24 }}>
                  People find you by your @username. Your email stays private.
                </Text>
                <Text muted style={styles.label}>
                  Username
                </Text>
                <View style={[styles.inputRow, { borderColor: c.border, backgroundColor: c.surface }]}>
                  <Text muted style={{ fontSize: 16 }}>
                    @
                  </Text>
                  <TextInput
                    value={username}
                    onChangeText={(t) => setUsername(normalizeUsername(t))}
                    editable={!pending}
                    autoFocus
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder="your_name"
                    returnKeyType="next"
                    style={styles.input}
                    accessibilityLabel="Username"
                  />
                  {availability === "checking" ? <Spinner /> : null}
                  {availability === "available" ? <Icon name="checkmark-circle" color={c.success} /> : null}
                  {availability === "taken" ? <Icon name="close-circle" color={c.error} /> : null}
                </View>
                <Text style={{ color: hintColor, fontSize: 12.5, marginTop: 6 }}>{hint}</Text>

                <Text muted style={[styles.label, { marginTop: 16 }]}>
                  Display name (optional)
                </Text>
                <TextInput
                  value={displayName}
                  onChangeText={setDisplayName}
                  editable={!pending}
                  maxLength={Config.displayNameMax}
                  autoCapitalize="words"
                  placeholder={username || "Shown next to your messages"}
                  returnKeyType="done"
                  onSubmitEditing={submit}
                  style={[styles.inputRow, { borderColor: c.border, backgroundColor: c.surface, fontSize: 16 }]}
                  accessibilityLabel="Display name"
                />
                <ErrorText message={error} />
                <Button title="Continue" onPress={submit} loading={pending} disabled={!canSubmit} style={{ marginTop: 20 }} />
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 8 },
  container: { flexGrow: 1, justifyContent: "center" },
  card: { width: "100%", maxWidth: 420, alignSelf: "center" },
  title: { fontWeight: "600", marginBottom: 6 },
  label: { fontSize: 13, marginBottom: 6 },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 52,
    gap: 6,
  },
  input: { flex: 1, fontSize: 16, height: "100%" },
  check: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", marginBottom: 16 },
});
