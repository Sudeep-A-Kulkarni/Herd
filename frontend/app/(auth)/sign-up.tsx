import React, { useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView,
  Platform, ScrollView, ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/src/lib/auth";
import { theme } from "@/src/lib/theme";
import { Ionicons } from "@expo/vector-icons";

export default function SignUp() {
  const { signUp } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bikeModel, setBikeModel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    setError(null); setBusy(true);
    try {
      await signUp({
        email: email.trim(), password, username: username.trim(),
        display_name: displayName.trim() || username.trim(),
        bike_model: bikeModel.trim() || undefined,
      });
    } catch (e: any) {
      setError(e.message || "Signup failed");
    } finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable style={styles.back} onPress={() => router.back()} testID="sign-up-back-button">
          <Ionicons name="chevron-back" size={22} color={theme.color.text} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Text style={styles.h1}>Create your account</Text>
        <Text style={styles.sub}>Join the crew. Start tracking every ride.</Text>

        <View style={styles.form}>
          <Field label="Email" testID="sign-up-email-input" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
          <Field label="Password" testID="sign-up-password-input" value={password} onChangeText={setPassword} secureTextEntry />
          <Field label="Username" testID="sign-up-username-input" value={username} onChangeText={setUsername} autoCapitalize="none" />
          <Field label="Display name" testID="sign-up-displayname-input" value={displayName} onChangeText={setDisplayName} />
          <Field label="Bike model (optional)" testID="sign-up-bike-input" value={bikeModel} onChangeText={setBikeModel} placeholder="e.g. Yamaha MT-09" />

          {error ? <Text style={styles.error} testID="sign-up-error">{error}</Text> : null}
          <Pressable
            testID="sign-up-submit-button"
            style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
            onPress={onSubmit}
            disabled={busy}
          >
            {busy ? <ActivityIndicator color={theme.color.onBrand} /> :
              <Text style={styles.ctaText}>Create account</Text>}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, ...props }: any) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...props}
        placeholderTextColor={theme.color.textDim}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.surface },
  content: { padding: theme.space.xl, paddingTop: 60, paddingBottom: theme.space.xxxl },
  back: { flexDirection: "row", alignItems: "center", marginBottom: theme.space.xl },
  backText: { color: theme.color.text, marginLeft: 2, fontSize: 16 },
  h1: { color: theme.color.text, fontSize: 28, fontWeight: "800", letterSpacing: -0.4 },
  sub: { color: theme.color.textMuted, fontSize: 14, marginTop: 6, marginBottom: theme.space.xl },
  form: { gap: theme.space.sm },
  label: { color: theme.color.textDim, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", marginTop: theme.space.md, marginBottom: 6 },
  input: {
    backgroundColor: theme.color.surface2, borderColor: theme.color.border, borderWidth: 1,
    paddingHorizontal: theme.space.lg, paddingVertical: 14, borderRadius: theme.radius.md,
    color: theme.color.text, fontSize: 16,
  },
  cta: {
    backgroundColor: theme.color.brand, marginTop: theme.space.xl,
    paddingVertical: 16, borderRadius: theme.radius.md, alignItems: "center",
  },
  ctaText: { color: theme.color.onBrand, fontSize: 16, fontWeight: "800", letterSpacing: 0.3 },
  error: { color: theme.color.error, marginTop: theme.space.xs, fontSize: 13 },
});
