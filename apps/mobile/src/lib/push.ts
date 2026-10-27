import Constants from "expo-constants";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { request, type Tokens } from "./api";
import { notifications } from "./notifications";
import { color } from "./theme";

/**
 * Ask for permission and register this phone's Expo push token with GhostCart, for whichever account is
 * signed in (sellers get offers to approve, shoppers get decisions and shipping updates). Returns the
 * token, or why it couldn't.
 */
export async function registerForPush(tokens: Tokens): Promise<{ token?: string; reason?: string }> {
  if (Platform.OS === "web") return { reason: "Notifications need the phone app." };
  if (!Device.isDevice) return { reason: "Notifications need a real phone, not a simulator." };
  const Notifications = notifications();
  if (!Notifications) return { reason: "Notifications need the GhostCart app from the store (Expo Go on Android can't receive them)." };
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) return { reason: "Push isn't set up in this build yet (no EAS project id)." };
  if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("default", { name: "Deals and approvals", importance: Notifications.AndroidImportance.HIGH, lightColor: color.saffron });
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") return { reason: "Notifications are off for GhostCart in your phone's settings." };
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  const r = await request(tokens, "/api/push", { body: { token, platform: Platform.OS } });
  return r.ok ? { token } : { reason: r.error };
}

export async function unregisterPush(tokens: Tokens, token: string) {
  await request(tokens, "/api/push", { method: "DELETE", body: { token } });
}
