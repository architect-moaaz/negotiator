import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Body, Button, Card, ErrorText, Field, Screen, s, Title } from "@/components/ui";
import { inr } from "@/lib/format";
import { useSession } from "@/lib/session";
import { color } from "@/lib/theme";
import type { Deal, SellerAccount } from "@/lib/types";

type Waiting = Deal & { terms?: { floor: number; autoLimit: number; benchmark: number }; recommendation: { decision: string; reason: string } | null };

/** Sellers: offers below the agent's limit wait here (and arrive as notifications) for a decision. */
export default function Approvals() {
  const { api, tokens } = useSession();
  const params = useLocalSearchParams<{ storeId?: string }>();
  const [account, setAccount] = useState<SellerAccount | null>(null);
  const [picked, setPicked] = useState<string | undefined>();
  const [waiting, setWaiting] = useState<Waiting[] | null>(null);
  const [counter, setCounter] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!tokens.member) return;
    api<SellerAccount>("/api/seller/account").then((r) => {
      if (!r.ok) return setError(r.error);
      setAccount(r.data);
    });
  }, [api, tokens.member]);

  // A tapped notification picks the store; otherwise the seller's choice, then their first store.
  const storeId = params.storeId ?? picked ?? account?.orgs[0]?.stores[0]?.id;
  const setStoreId = (id: string) => {
    setPicked(id);
    if (params.storeId) router.setParams({ storeId: id });
  };

  const load = useCallback(async () => {
    if (!storeId) return;
    const r = await api<{ waiting: Waiting[] }>(`/api/seller/stores/${storeId}/approvals`);
    if (!r.ok) return setError(r.error);
    setWaiting(r.data.waiting);
    setError("");
  }, [api, storeId]);
  useFocusEffect(
    useCallback(() => {
      load();
      const t = setInterval(load, 5000);
      return () => clearInterval(t);
    }, [load]),
  );

  async function decide(d: Waiting, decision: "approved" | "rejected" | "counter") {
    setBusy(`${d.id}:${decision}`);
    setError("");
    const r = await api(`/api/seller/stores/${storeId}/approvals`, { body: { dealId: d.id, decision, price: decision === "counter" ? Number(counter[d.id]) : undefined } });
    setBusy("");
    if (!r.ok) setError(r.error);
    load();
  }

  if (!tokens.member)
    return (
      <Screen>
        <Title>Approvals</Title>
        <Body muted>For sellers: sign in with your store phone number to approve offers your agent can&apos;t take on its own. You&apos;ll get a notification for each one.</Body>
        <Button label="Sign in as a seller" onPress={() => router.push({ pathname: "/sign-in", params: { as: "member" } })} />
      </Screen>
    );

  const stores = account?.orgs.flatMap((o) => o.stores) ?? [];
  return (
    <Screen>
      <Title>Approvals</Title>
      {stores.length > 1 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {stores.map((st) => (
            <Pressable key={st.id} accessibilityRole="button" accessibilityState={{ selected: st.id === storeId }} onPress={() => setStoreId(st.id)} style={{ borderWidth: 1, borderColor: st.id === storeId ? color.saffron : color.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
              <Text style={{ color: color.fg }}>{st.name}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {account && !stores.length && <Body muted>This number isn&apos;t on any store yet. Set one up on the GhostCart website.</Body>}
      <ErrorText>{error}</ErrorText>
      {waiting?.length === 0 && <Body muted>Nothing waiting. Offers your agent can&apos;t accept on its own will show up here.</Body>}
      {waiting?.map((d) => (
        <Card key={d.id}>
          <Text style={[s.body, { fontWeight: "700" }]}>{d.product.title}</Text>
          <Body>
            Shopper offers <Text style={{ color: color.saffron, fontWeight: "700" }}>{inr(d.negotiation?.approvalPrice ?? d.dealPrice)}</Text> against your list price {inr(d.originalPrice)}.
          </Body>
          {d.terms && <Body muted>{`Your agent could go to ${inr(d.terms.autoLimit)} alone; your floor is ${inr(d.terms.floor)}.`}</Body>}
          {d.recommendation && <Body muted>{`Deal-desk agent suggests ${d.recommendation.decision}: ${d.recommendation.reason}`}</Body>}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button label="Approve" busy={busy === `${d.id}:approved`} onPress={() => decide(d, "approved")} />
            </View>
            <View style={{ flex: 1 }}>
              <Button kind="danger" label="Reject" busy={busy === `${d.id}:rejected`} onPress={() => decide(d, "rejected")} />
            </View>
          </View>
          <Field label="Or counter with (₹)" keyboardType="number-pad" value={counter[d.id] ?? ""} onChangeText={(v) => setCounter({ ...counter, [d.id]: v.replace(/\D/g, "") })} />
          <Button kind="secondary" label="Send counter-offer" disabled={!counter[d.id]} busy={busy === `${d.id}:counter`} onPress={() => decide(d, "counter")} />
        </Card>
      ))}
    </Screen>
  );
}
