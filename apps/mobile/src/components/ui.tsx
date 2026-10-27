import type { ReactNode } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { color } from "@/lib/theme";

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  return (
    <SafeAreaView style={s.screen} edges={["top", "left", "right"]}>
      {/* Android draws edge to edge, so the window no longer shrinks for the keyboard: pad for it here. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "android" ? "padding" : undefined}>
        {scroll ? (
          // The keyboard (a number pad with no Done key on iOS) mustn't hide the field being typed in or the
          // button under it: the content scrolls above the keyboard, and dragging dismisses it.
          <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
            {children}
          </ScrollView>
        ) : (
          <View style={[s.content, { flex: 1 }]}>{children}</View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export const Title = ({ children }: { children: ReactNode }) => (
  <Text style={s.title} accessibilityRole="header">
    {children}
  </Text>
);
export const Body = ({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: object }) => <Text style={[s.body, muted && { color: color.muted }, style]}>{children}</Text>;
export const ErrorText = ({ children }: { children?: string }) => (children ? <Text style={s.error} accessibilityRole="alert">{children}</Text> : null);

export function Button({ label, onPress, kind = "primary", busy, disabled }: { label: string; onPress: () => void; kind?: "primary" | "secondary" | "danger"; busy?: boolean; disabled?: boolean }) {
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [s.button, kind === "primary" ? s.primary : kind === "danger" ? s.danger : s.secondary, (pressed || off) && { opacity: 0.6 }]}
    >
      {busy ? <ActivityIndicator color={kind === "primary" ? color.paperInk : color.fg} /> : <Text style={[s.buttonText, kind === "primary" && { color: color.paperInk }]}>{label}</Text>}
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor={color.muted} accessibilityLabel={label} style={s.input} {...props} />
    </View>
  );
}

export const Card = ({ children }: { children: ReactNode }) => <View style={s.card}>{children}</View>;

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ink },
  content: { padding: 16, gap: 16, paddingBottom: 48 },
  title: { color: color.fg, fontSize: 28, fontWeight: "700", letterSpacing: -0.5 },
  body: { color: color.fg, fontSize: 16, lineHeight: 22 },
  label: { color: color.muted, fontSize: 14 },
  error: { color: color.alarm, fontSize: 15 },
  input: { borderWidth: 1, borderColor: color.line, backgroundColor: color.panel, color: color.fg, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  button: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 18, alignItems: "center", justifyContent: "center", minHeight: 48 },
  primary: { backgroundColor: color.saffron },
  secondary: { borderWidth: 1, borderColor: color.line },
  danger: { borderWidth: 1, borderColor: color.alarm },
  buttonText: { color: color.fg, fontSize: 16, fontWeight: "600" },
  card: { borderWidth: 1, borderColor: color.line, borderRadius: 16, padding: 16, gap: 10 },
});
