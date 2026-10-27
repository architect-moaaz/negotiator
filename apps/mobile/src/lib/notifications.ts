import { isRunningInExpoGo } from "expo";
import { Platform } from "react-native";

type Notifications = typeof import("expo-notifications");
let handlerSet = false;

/**
 * expo-notifications, or null where it can't load: on the web, and in Expo Go on Android, where push was
 * removed in SDK 53 and merely importing the module crashes the app. Development and store builds always
 * get it.
 */
export function notifications(): Notifications | null {
  if (Platform.OS === "web") return null;
  if (Platform.OS === "android" && isRunningInExpoGo()) return null;
  let N: Notifications | undefined;
  try {
    // Loaded on demand so the unsupported cases above never evaluate it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    N = require("expo-notifications") as Notifications;
  } catch {
    N = undefined;
  }
  if (!N?.setNotificationHandler) return null;
  if (!handlerSet) {
    N.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
    });
    handlerSet = true;
  }
  return N;
}
