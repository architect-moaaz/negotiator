import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { Body, Button, ErrorText, Field, Screen, Title } from "@/components/ui";
import { tenDigits } from "@/lib/format";
import { useSession } from "@/lib/session";
import { color } from "@/lib/theme";

/** The exact consent words from the web signup (apps/web lib/privacy/consent.ts). */
const CONSENT = "GhostCart and this seller can contact me on this number about this deal. No marketing.";

/**
 * Phone sign-in: we call the number with a code. Shoppers without an account sign up here (name plus
 * consent); sellers sign in with a number already on their store.
 */
export default function SignIn() {
  const { as } = useLocalSearchParams<{ as?: "buyer" | "member" }>();
  const kind = as === "member" ? "member" : "buyer";
  const { api, signIn } = useSession();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function sendCode() {
    const digits = tenDigits(phone);
    if (!digits) return setError("Enter a 10-digit Indian mobile number.");
    setBusy(true);
    setError("");
    const r =
      mode === "signup"
        ? await api("/api/signup", { body: { name, phone: digits, consent, source: "app", client: "mobile" } })
        : await api("/api/auth/code", { body: { role: kind, phone: digits } });
    setBusy(false);
    if (r.ok) return setSent(true);
    if (r.status === 404 && kind === "buyer") {
      setMode("signup");
      return setError("New here? Add your name to create an account.");
    }
    setError(r.error);
  }

  async function verify() {
    const digits = tenDigits(phone)!;
    setBusy(true);
    setError("");
    const r =
      mode === "signup"
        ? await api<{ token: string }>("/api/signup", { body: { name, phone: digits, consent, code, source: "app", client: "mobile" } })
        : await api<{ token: string }>("/api/auth/verify", { body: { role: kind, phone: digits, code, client: "mobile" } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    await signIn(kind, r.data.token);
    router.back();
  }

  return (
    <Screen>
      <Title>{kind === "member" ? "Seller sign in" : mode === "signup" ? "Create your account" : "Sign in"}</Title>
      <Body muted>We&apos;ll call your number and read out a code.</Body>
      {mode === "signup" && <Field label="Your name" value={name} onChangeText={setName} autoComplete="name" editable={!sent} />}
      <Field label="Mobile number" keyboardType="phone-pad" autoComplete="tel" value={phone} onChangeText={setPhone} placeholder="98765 43210" editable={!sent} />
      {mode === "signup" && (
        <Pressable accessibilityRole="switch" accessibilityState={{ checked: consent }} onPress={() => setConsent(!consent)} style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
          <Switch value={consent} onValueChange={setConsent} trackColor={{ true: color.saffron, false: color.line }} />
          <Text style={{ color: color.muted, flex: 1 }}>{CONSENT}</Text>
        </Pressable>
      )}
      {sent && <Field label="Code" keyboardType="number-pad" autoComplete="one-time-code" maxLength={6} value={code} onChangeText={(v) => setCode(v.replace(/\D/g, ""))} />}
      <ErrorText>{error}</ErrorText>
      <View style={{ gap: 10 }}>
        {sent ? (
          <Button label="Sign in" busy={busy} disabled={code.length < 4} onPress={verify} />
        ) : (
          <Button label="Call me with a code" busy={busy} disabled={mode === "signup" && (!name.trim() || !consent)} onPress={sendCode} />
        )}
        {sent && <Button kind="secondary" label="Use a different number" onPress={() => {
              setSent(false);
              setCode("");
            }} />}
      </View>
    </Screen>
  );
}
