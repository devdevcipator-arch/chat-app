import * as Clipboard from "expo-clipboard";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Config } from "../lib/config";
import { authErrorMessage } from "../lib/errors";
import { supabase } from "../lib/supabase";
import { Button, ErrorText, Icon } from "../ui/components";
import { OtpInput } from "../ui/OtpInput";
import { Text, TextInput } from "../ui/Text";
import { usePalette, useScale } from "../ui/theme";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 6-digit email OTP sign-in. On success the auth stream switches the app to Chats / onboarding. */
export default function SignIn() {
  const c = usePalette();
  const { s } = useScale();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const t = setTimeout(() => setSecondsLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft]);

  const sendCode = async (address: string) => {
    const { error: e } = await supabase.auth.signInWithOtp({ email: address, options: { shouldCreateUser: true } });
    if (e) {
      setError(authErrorMessage(e));
      return false;
    }
    setSecondsLeft(Config.resendCooldownSeconds);
    return true;
  };

  const submitEmail = async () => {
    const address = email.trim().toLowerCase();
    if (!EMAIL.test(address)) {
      setError("Please enter a valid email address.");
      return;
    }
    setError(null);
    setPending(true);
    const sent = await sendCode(address).catch((e) => {
      setError(authErrorMessage(e));
      return false;
    });
    setPending(false);
    if (sent) {
      setEmail(address);
      setCode("");
      setStep("code");
    }
  };

  const verify = async (token: string) => {
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const { error: e } = await supabase.auth.verifyOtp({ email, token, type: "email" });
      if (e) throw e;
      // The auth stream (SIGNED_IN) replaces this screen.
    } catch (e) {
      setPending(false);
      setError(authErrorMessage(e));
      setCode("");
    }
  };

  const resend = async () => {
    if (secondsLeft > 0 || pending) return;
    setError(null);
    setPending(true);
    await sendCode(email).catch((e) => setError(authErrorMessage(e)));
    setPending(false);
  };

  const paste = async () => {
    const digits = (await Clipboard.getStringAsync()).replace(/\D/g, "").slice(0, Config.otpLength);
    if (!digits) return;
    setCode(digits);
    if (digits.length === Config.otpLength) void verify(digits);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={[styles.container, { padding: s(24) }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.card}>
            <View style={[styles.lock, { backgroundColor: c.primary }]}>
              <Icon name="lock-closed-outline" color="#fff" />
            </View>
            {step === "email" ? (
              <>
                <Text style={[styles.title, { fontSize: s(24) }]}>Sign in</Text>
                <Text muted style={styles.subtitle}>
                  We'll email you a {Config.otpLength}-digit code. No password, no phone number.
                </Text>
                <TextInput
                  value={email}
                  onChangeText={(t) => {
                    setEmail(t);
                    if (error) setError(null);
                  }}
                  editable={!pending}
                  autoFocus
                  placeholder="you@example.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  textContentType="emailAddress"
                  returnKeyType="go"
                  onSubmitEditing={submitEmail}
                  style={[styles.input, { borderColor: c.border, backgroundColor: c.surface }]}
                  accessibilityLabel="Email"
                />
                <ErrorText message={error} />
                <Button title="Continue" onPress={submitEmail} loading={pending} style={{ marginTop: 20 }} />
                <Text muted style={styles.footnote}>
                  Your email is only used to sign you in. Other people see your @username, never your email.
                </Text>
              </>
            ) : (
              <>
                <Text style={[styles.title, { fontSize: s(24) }]}>Check your email</Text>
                <Text muted style={styles.subtitle}>
                  Enter the code we sent to <Text style={{ fontWeight: "600" }}>{email}</Text>
                </Text>
                <OtpInput
                  length={Config.otpLength}
                  value={code}
                  onChange={setCode}
                  onComplete={verify}
                  disabled={pending}
                  error={!!error}
                />
                <ErrorText message={error} />
                <Button
                  title="Verify"
                  loading={pending}
                  disabled={code.length !== Config.otpLength}
                  onPress={() => void verify(code)}
                  style={{ marginTop: 20 }}
                />
                <View style={styles.links}>
                  <Button
                    title="Change email"
                    icon="arrow-back"
                    variant="text"
                    compact
                    disabled={pending}
                    onPress={() => {
                      setStep("email");
                      setError(null);
                      setCode("");
                    }}
                  />
                  <View style={{ flexDirection: "row" }}>
                    <Button title="Paste" variant="text" compact disabled={pending} onPress={paste} />
                    <Button
                      title={secondsLeft > 0 ? `Resend in ${secondsLeft}s` : "Resend code"}
                      variant="text"
                      compact
                      disabled={secondsLeft > 0 || pending}
                      onPress={resend}
                    />
                  </View>
                </View>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: "center" },
  card: { width: "100%", maxWidth: 420, alignSelf: "center" },
  lock: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", marginBottom: 24 },
  title: { fontWeight: "600", marginBottom: 6 },
  subtitle: { marginBottom: 24, lineHeight: 21 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, height: 52, fontSize: 16 },
  footnote: { fontSize: 12.5, marginTop: 20, lineHeight: 18 },
  links: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 12, flexWrap: "wrap" },
});
