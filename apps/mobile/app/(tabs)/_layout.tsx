import { Tabs } from "expo-router";
import { Text, type ColorValue } from "react-native";
import { color } from "@/lib/theme";

function TabGlyph({ glyph, tint }: { glyph: string; tint: ColorValue }) {
  return <Text style={{ color: tint, fontSize: 18 }}>{glyph}</Text>;
}
const icon = (glyph: string) => {
  const Icon = ({ color: tint }: { color: ColorValue }) => <TabGlyph glyph={glyph} tint={tint} />;
  Icon.displayName = `TabIcon(${glyph})`;
  return Icon;
};

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarStyle: { backgroundColor: color.ink, borderTopColor: color.line }, tabBarActiveTintColor: color.saffron, tabBarInactiveTintColor: color.muted }}>
      <Tabs.Screen name="index" options={{ title: "Shop", tabBarIcon: icon("⌕") }} />
      <Tabs.Screen name="deals" options={{ title: "My deals", tabBarIcon: icon("₹") }} />
      <Tabs.Screen name="approvals" options={{ title: "Approvals", tabBarIcon: icon("✓") }} />
      <Tabs.Screen name="account" options={{ title: "Account", tabBarIcon: icon("☺") }} />
    </Tabs>
  );
}
