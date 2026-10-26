import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { FlatList, Image, Pressable, RefreshControl, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ErrorText, Field, s, Title } from "@/components/ui";
import { inr } from "@/lib/format";
import { useSession } from "@/lib/session";
import { color } from "@/lib/theme";
import type { CatalogueItem } from "@/lib/types";

/** Everything on offer across GhostCart shops; tap an item to make an offer. */
export default function Shop() {
  const { api, tokens } = useSession();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<CatalogueItem[] | null>(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState<string | null>(null);

  const load = useCallback(
    async (query: string) => {
      const r = await api<{ items: CatalogueItem[] }>(`/api/catalogue?q=${encodeURIComponent(query)}`);
      if (!r.ok) return setError(r.error);
      setItems(r.data.items);
      setError("");
    },
    [api],
  );
  useEffect(() => {
    const t = setTimeout(() => load(q), q ? 350 : 0);
    return () => clearTimeout(t);
  }, [q, load]);

  async function haggle(item: CatalogueItem) {
    if (!tokens.buyer) return router.push({ pathname: "/sign-in", params: { as: "buyer" } });
    setStarting(item.productId);
    const r = await api<{ id: string }>("/api/shop/haggle", { body: { productId: item.productId } });
    setStarting(null);
    if (!r.ok) return setError(r.error);
    router.push({ pathname: "/deal/[id]", params: { id: r.data.id } });
  }

  return (
    <SafeAreaView style={s.screen} edges={["top", "left", "right"]}>
      <FlatList
        data={items ?? []}
        keyExtractor={(i) => i.productId}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => load(q)} tintColor={color.saffron} />}
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            <Title>Every price is open to a bargain</Title>
            <Field label="Search" testID="search" value={q} onChangeText={setQ} placeholder="Kurta, kettle, phone…" returnKeyType="search" autoCorrect={false} />
            <ErrorText>{error}</ErrorText>
            {items?.length === 0 && <Text style={[s.body, { color: color.muted }]}>Nothing matches yet. Try a broader word.</Text>}
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.title}, ${inr(item.price)} at ${item.storeName}. Make an offer.`}
            onPress={() => haggle(item)}
            style={({ pressed }) => [{ flexDirection: "row", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: color.line }, pressed && { opacity: 0.7 }]}
          >
            {item.image ? <Image source={{ uri: item.image }} style={{ width: 72, height: 72, borderRadius: 10 }} /> : <View style={{ width: 72, height: 72, borderRadius: 10, backgroundColor: color.panel }} />}
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.body} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={{ color: color.muted }}>{item.storeName}</Text>
              <Text style={[s.body, { fontWeight: "600" }]}>
                {inr(item.price)}
                {item.mrp && item.mrp > item.price ? <Text style={{ color: color.muted, textDecorationLine: "line-through", fontWeight: "400" }}> {inr(item.mrp)}</Text> : null}
              </Text>
            </View>
            <Text style={{ color: color.saffron, alignSelf: "center" }}>{starting === item.productId ? "Opening…" : "Make an offer"}</Text>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}
