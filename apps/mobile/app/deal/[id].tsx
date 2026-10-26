import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Body, Button, Card, ErrorText, Field, Screen, s, Title } from "@/components/ui";
import { clock, inr } from "@/lib/format";
import { openPayment } from "@/lib/pay";
import { useSession } from "@/lib/session";
import { color } from "@/lib/theme";
import type { Deal } from "@/lib/types";

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

const STAGES: Record<string, string> = { placed: "Order placed", confirmed: "Seller confirmed", shipped: "Shipped", out_for_delivery: "Out for delivery", delivered: "Delivered" };

/** One deal end to end: haggle with the shop's agent, lock the price by UPI, give an address, track it. */
export default function DealScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useSession();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [offer, setOffer] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [to, setTo] = useState({ name: "", phone: "", line1: "", city: "", state: "", pincode: "" });

  const load = useCallback(async () => {
    const r = await api<Deal>(`/api/deal?id=${encodeURIComponent(id)}`);
    if (r.ok) setDeal(r.data);
    else setError(r.error);
  }, [api, id]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  // Poll while something can change without the shopper acting: the seller deciding, a payment landing, delivery.
  const waiting = deal && (deal.status === "awaiting_approval" || deal.status === "pending" || (deal.status === "paid" && deal.checkout?.status === "awaiting") || (deal.checkout?.status === "ordered" && deal.checkout.tracking?.at(-1)?.stage !== "delivered"));
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(load, deal?.checkout?.status === "ordered" ? 10_000 : 3000);
    return () => clearInterval(t);
  }, [waiting, load, deal?.checkout?.status]);
  const now = useNow(deal?.status === "pending" || deal?.checkout?.status === "awaiting");

  async function act(key: string, path: string, body: unknown) {
    setBusy(key);
    setError("");
    const r = await api<Deal>(path, { body });
    setBusy("");
    if (r.ok) setDeal(r.data);
    else setError(r.error);
    return r.ok;
  }
  async function pay(intent?: string) {
    if (!intent) return setError("The payment link isn't ready yet. Pull to refresh in a moment.");
    try {
      await openPayment(intent);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!deal) return <Screen>{error ? <ErrorText>{error}</ErrorText> : <Body muted>Loading your deal…</Body>}</Screen>;
  const n = deal.negotiation;
  const c = deal.checkout;

  return (
    <Screen>
      <Title>{deal.product.title}</Title>
      <Body muted>
        List price {inr(deal.originalPrice)}
        {deal.shop ? ` at ${deal.shop.storeName}` : ""}
      </Body>

      {n && (
        <Card>
          {n.messages.map((m, i) => (
            <View key={i} style={{ alignSelf: m.from === "shopper" ? "flex-end" : "flex-start", maxWidth: "85%", backgroundColor: m.from === "shopper" ? color.saffron : color.panel, borderRadius: 14, padding: 10 }}>
              <Text style={{ color: m.from === "shopper" ? color.paperInk : color.fg, fontSize: 15 }}>{m.text}</Text>
            </View>
          ))}
        </Card>
      )}

      {deal.status === "negotiating" && n && (
        <View style={{ gap: 12 }}>
          <Body>
            Current offer <Text style={{ fontWeight: "700" }}>{inr(n.currentOffer)}</Text>
          </Body>
          <Field label="Your offer (₹)" testID="offer" keyboardType="number-pad" value={offer} onChangeText={(v) => setOffer(v.replace(/\D/g, ""))} placeholder={String(Math.round(n.currentOffer * 0.95))} />
          <Button label="Send offer" busy={busy === "offer"} disabled={!offer} onPress={() => act("offer", "/api/haggle", { id: deal.id, offer: Number(offer) }).then((ok) => ok && setOffer(""))} />
          <Button kind="secondary" label={`Take ${inr(n.currentOffer)}`} busy={busy === "accept"} onPress={() => act("accept", "/api/haggle", { id: deal.id, accept: true })} />
        </View>
      )}

      {deal.status === "awaiting_approval" && <Body muted>Your offer of {inr(n?.approvalPrice ?? deal.dealPrice)} is with the seller. We&apos;ll update this the moment they decide.</Body>}

      {deal.status === "pending" && (
        <Card>
          <Body>
            Agreed at <Text style={{ fontWeight: "700" }}>{inr(deal.dealPrice)}</Text>. Pay {inr(deal.lockFee)} by UPI within {clock(deal.expiresAt - now)} to lock it.
          </Body>
          {deal.testPayments && <Body muted>Test mode: no money moves.</Body>}
          <Button label={`Pay ${inr(deal.lockFee)} to lock`} onPress={() => pay(deal.upiIntent)} />
        </Card>
      )}

      {deal.status === "paid" && c?.status === "awaiting" && !c.upiIntent && (
        <Card>
          <Body>Locked. Where should it go? You have {clock(c.dueAt - now)} to finish.</Body>
          <Field label="Name" value={to.name} onChangeText={(v) => setTo({ ...to, name: v })} autoComplete="name" />
          <Field label="Phone for the delivery partner" keyboardType="phone-pad" value={to.phone} onChangeText={(v) => setTo({ ...to, phone: v })} />
          <Field label="House, flat and street" value={to.line1} onChangeText={(v) => setTo({ ...to, line1: v })} autoComplete="street-address" />
          <Field label="City" value={to.city} onChangeText={(v) => setTo({ ...to, city: v })} />
          <Field label="State" value={to.state} onChangeText={(v) => setTo({ ...to, state: v })} />
          <Field label="Pincode" keyboardType="number-pad" maxLength={6} value={to.pincode} onChangeText={(v) => setTo({ ...to, pincode: v.replace(/\D/g, "") })} />
          <Button label="Continue to payment" busy={busy === "address"} onPress={() => act("address", "/api/deal/checkout", { id: deal.id, action: "address", address: to })} />
        </Card>
      )}
      {deal.status === "paid" && c?.status === "awaiting" && c.upiIntent && (
        <Card>
          <Body>
            Pay the balance of <Text style={{ fontWeight: "700" }}>{inr(c.amount)}</Text> to place your order{c.deliverTo ? `, delivering to ${c.deliverTo.name} in ${c.deliverTo.area}` : ""}.
          </Body>
          <Button label={`Pay ${inr(c.amount)}`} onPress={() => pay(c.upiIntent)} />
        </Card>
      )}
      {c?.status === "ordered" && (
        <Card>
          <Text style={[s.body, { fontWeight: "700" }]}>Order {c.orderRef}</Text>
          {c.courier && <Body muted>{`${c.courier} · AWB ${c.awb}`}</Body>}
          {c.tracking?.map((t, i) => (
            <Body key={i} muted={i < (c.tracking?.length ?? 0) - 1}>
              {STAGES[t.stage] ?? t.stage}
              {t.note ? ` · ${t.note}` : ""}
            </Body>
          ))}
        </Card>
      )}
      {c?.status === "lapsed" && <Body muted>The 30 minutes ran out, so the price lock was released.</Body>}
      {deal.status === "expired" && <Body muted>This deal expired. Find the item in Shop to start again.</Body>}
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
