/**
 * Push notifications: register the device with our backend so pushes can
 * reach this user. Native-only; safe no-op on web.
 */
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { api } from "@/src/lib/api";

export async function registerForPush(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== "granted") return;
    const tokenResp = await Notifications.getDevicePushTokenAsync();
    if (!tokenResp?.data) return;
    await api.post("/register-push", {
      platform: Platform.OS,
      device_token: tokenResp.data,
    });
  } catch {
    // never block app flow on push registration
  }
}
