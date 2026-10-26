import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Body, Button, ErrorText, Screen, s, Title } from "@/components/ui";
import { inr } from "@/lib/format";
import { useSession } from "@/lib/session";
import { color } from "@/lib/theme";
import type { Deal, DealStatus } from "@/lib/types";

const STATUS: Record<DealStatus, string> = { negotiating: "Haggling", awaiting_approval: "Waiting for the seller", pending: "Agreed, pay to lock", paid: "Locked", granted: "Code ready", expired: "Expired" };

export default function Deals() {
  const { api, tokens } = useSession();
  const [deals, setDeals] = useState<Deal[] | null>(null);
  const [error, setError] = useState("");

  useFocusEffect(
    useCallback(() => {
      if (!tokens.buyer) return;
      api<{ deals: Deal[] }>("/api/me/deals").then((r) => (r.ok ? setDeals(r.data.deals) : setError(r.error)));
    }, [api, tokens.buyer]),
  );

  if (!tokens.buyer)
    return (
      <Screen>
        <Title>My deals</Title>
        <Body muted>Sign in to see the deals you&apos;ve haggled.</Body>
        <Button label="Sign in" onPress={() => router.push({ pathname: "/sign-in", params: { as: "buyer" } })} />
      </Screen>
    );
  return (
    <Screen>
      <Title>My deals</Title>
      <ErrorText>{error}</ErrorText>
      {deals?.length === 0 && <Body muted>No deals yet. Find something in Shop and make an offer.</Body>}
      <View>
        {deals?.map((d) => (
          <Pressable key={d.id} accessibilityRole="button" onPress={() => router.push({ pathname: "/deal/[id]", params: { id: d.id } })} style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: color.line }}>
            <View style={{ flex: 1 }}>
              <Text style={s.body} numberOfLines={1}>
                {d.product.title}
              </Text>
              <Text style={{ color: color.muted }}>{d.checkout?.status === "ordered" ? "Ordered" : STATUS[d.status]}</Text>
            </View>
            <Text style={[s.body, { fontVariant: ["tabular-nums"] }]}>{inr(d.dealPrice)}</Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}
