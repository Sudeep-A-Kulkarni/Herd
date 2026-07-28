import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { LogBox, View, ActivityIndicator, StyleSheet, Platform, Linking } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";

import { storage } from "@/src/utils/storage";
import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AuthProvider, useAuth } from "@/src/lib/auth";
import { theme } from "@/src/lib/theme";
import { registerForPush } from "@/src/lib/push";

LogBox.ignoreAllLogs(true);
SplashScreen.preventAutoHideAsync();

// Foreground notification handler — module scope, native only
if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    } as any),
  });
}

// Android default channel — module scope
if (Platform.OS === "android") {
  Notifications.setNotificationChannelAsync("default", {
    name: "Default",
    importance: Notifications.AndroidImportance.MAX,
    sound: "default",
  });
}

function Gate() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const inAuth = segments[0] === "(auth)";
    if (!user && !inAuth) router.replace("/(auth)/sign-in");
    else if (user && inAuth) router.replace("/(tabs)");
  }, [user, loading, segments, router]);

  // Register push after login
  useEffect(() => { if (user) registerForPush(); }, [user]);

  // Notification tap handlers — native only
  useEffect(() => {
    if (Platform.OS === "web") return;
    const tapSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data: any = response.notification.request.content.data || {};
      const url = data.deeplink || data.action_url;
      if (!url) return;
      if (typeof url === "string" && url.startsWith("http")) Linking.openURL(url);
      else router.push(url);
    });
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const data: any = response.notification.request.content.data || {};
      const url = data.deeplink || data.action_url;
      if (!url) return;
      if (typeof url === "string" && url.startsWith("http")) Linking.openURL(url);
      else router.push(url);
    });
    // Denied-permission weekly nudge
    (async () => {
      try {
        const { status, canAskAgain } = await Notifications.getPermissionsAsync();
        if (status !== "denied" || canAskAgain) return;
        const last = await storage.get<number>("bf_push_nudge_at", 0);
        const oneWeek = 7 * 24 * 60 * 60 * 1000;
        if (last && Date.now() - Number(last) <= oneWeek) return;
        await storage.set("bf_push_nudge_at", Date.now());
        // Best-effort: open settings so user can re-enable
        Linking.openSettings();
      } catch { /* ignore */ }
    })();
    return () => { tapSub.remove(); };
  }, [router]);

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator color={theme.color.brand} size="large" />
      </View>
    );
  }
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.color.surface } }} />;
}

export default function RootLayout() {
  const [loaded, error] = useIconFonts();

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync();
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loader: { flex: 1, backgroundColor: theme.color.surface, alignItems: "center", justifyContent: "center" },
});
