import React, { useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView,
  Platform, ImageBackground, ActivityIndicator, ScrollView,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useAuth } from "@/src/lib/auth";
import { theme } from "@/src/lib/theme";
import { Ionicons } from "@expo/vector-icons";

export default function SignIn() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("rider@bike.com");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    setError(null); setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (e: any) {
      setError(e.message || "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ImageBackground
      source={{ uri: "https://images.pexels.com/photos/31777129/pexels-photo-31777129.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940" }}
      style={styles.bg}
      resizeMode="cover"
    >
      <LinearGradient
        colors={["rgba(13,14,17,0.2)", "rgba(13,14,17,0.85)", "rgba(13,14,17,1)"]}
        style={StyleSheet.absoluteFill}
      />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.logoWrap}>
            <View style={styles.logoBadge}>
              <Ionicons name="speedometer" size={26} color={theme.color.onBrand} />
            </View>
            <Text style={styles.brand}>BikeFriends</Text>
            <Text style={styles.tagline}>Ride together. Track together.</Text>
          </View>

          <View style={styles.form}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              testID="sign-in-email-input"
              value={email}
              onChangeText={setEmail}
              placeholder="you@ride.com"
              placeholderTextColor={theme.color.textDim}
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.input}
            />
            <Text style={styles.label}>Password</Text>
            <TextInput
              testID="sign-in-password-input"
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={theme.color.textDim}
              secureTextEntry
              style={styles.input}
            />
            {error ? <Text style={styles.error} testID="sign-in-error">{error}</Text> : null}

            <Pressable
              testID="sign-in-submit-button"
              style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
              onPress={onSubmit}
              disabled={busy}
            >
              {busy ? <ActivityIndicator color={theme.color.onBrand} /> :
                <Text style={styles.ctaText}>Sign in</Text>}
            </Pressable>

            <Pressable testID="go-to-sign-up-button" onPress={() => router.push("/(auth)/sign-up")}>
              <Text style={styles.linkText}>
                New to BikeFriends? <Text style={{ color: theme.color.brand, fontWeight: "700" }}>Create account</Text>
              </Text>
            </Pressable>

            <View style={styles.hint}>
              <Ionicons name="information-circle" size={14} color={theme.color.textMuted} />
              <Text style={styles.hintText}>Demo: rider@bike.com / password123</Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: theme.color.surface },
  content: { flexGrow: 1, justifyContent: "flex-end", padding: theme.space.xl, paddingBottom: theme.space.xxxl },
  logoWrap: { alignItems: "flex-start", marginBottom: theme.space.xxl },
  logoBadge: {
    width: 48, height: 48, borderRadius: 12, backgroundColor: theme.color.brand,
    alignItems: "center", justifyContent: "center", marginBottom: theme.space.md,
  },
  brand: { color: theme.color.text, fontSize: 34, fontWeight: "800", letterSpacing: -0.5 },
  tagline: { color: theme.color.textMuted, fontSize: 14, marginTop: 4 },
  form: { gap: theme.space.sm },
  label: { color: theme.color.textDim, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", marginTop: theme.space.md },
  input: {
    backgroundColor: theme.color.surface2,
    borderColor: theme.color.border, borderWidth: 1,
    paddingHorizontal: theme.space.lg, paddingVertical: 14,
    borderRadius: theme.radius.md, color: theme.color.text, fontSize: 16,
  },
  cta: {
    backgroundColor: theme.color.brand, marginTop: theme.space.lg,
    paddingVertical: 16, borderRadius: theme.radius.md, alignItems: "center",
  },
  ctaText: { color: theme.color.onBrand, fontSize: 16, fontWeight: "800", letterSpacing: 0.3 },
  linkText: { color: theme.color.textMuted, textAlign: "center", marginTop: theme.space.lg, fontSize: 14 },
  error: { color: theme.color.error, marginTop: theme.space.xs, fontSize: 13 },
  hint: { flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center", marginTop: theme.space.md },
  hintText: { color: theme.color.textMuted, fontSize: 12 },
});
