import { router, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { notifications } from "@/lib/notifications";
import { SessionProvider } from "@/lib/session";
import { color } from "@/lib/theme";

type Data = { type?: string; dealId?: string; storeId?: string };

/** Open what a tapped notification is about: an offer to approve, or the shopper's deal. */
function openFromNotification(data: Data) {
  if (data.type === "approval" && data.storeId) router.push({ pathname: "/approvals", params: { storeId: data.storeId } });
  else if (data.dealId) router.push({ pathname: "/deal/[id]", params: { id: data.dealId } });
}

export default function RootLayout() {
  useEffect(() => {
    const Notifications = notifications();
    if (!Notifications) return;
    const last = Notifications.getLastNotificationResponse();
    if (last) openFromNotification(last.notification.request.content.data as Data);
    const sub = Notifications.addNotificationResponseReceivedListener((r) => openFromNotification(r.notification.request.content.data as Data));
    return () => sub.remove();
  }, []);

  return (
    <SessionProvider>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerStyle: { backgroundColor: color.ink }, headerTintColor: color.fg, contentStyle: { backgroundColor: color.ink } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false, title: "GhostCart" }} />
        <Stack.Screen name="deal/[id]" options={{ title: "Your deal" }} />
        <Stack.Screen name="sign-in" options={{ title: "Sign in", presentation: "modal" }} />
      </Stack>
    </SessionProvider>
  );
}
