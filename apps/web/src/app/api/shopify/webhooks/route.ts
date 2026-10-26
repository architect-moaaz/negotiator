import { accounts, assertBalanced, orderMoney } from "@ghostcart/core";
import { getDb } from "@/lib/db";
import { redeemGrant } from "@/lib/grants/service";
import { post } from "@/lib/orders/ledger";
import { verifyWebhookHmac } from "@/lib/shopify/auth";
import { recordShopifyUsage } from "@/lib/shopify/billing";
import { connectionForShop, updateConnection } from "@/lib/shopify/connections";
import { archiveShopifyProduct, syncShopifyProductWebhook } from "@/lib/shopify/sync";
import { updateStore } from "@/lib/shop/stores";
import { store as kv } from "@/lib/store";

/** Every Shopify webhook, including the three mandatory privacy topics. Verified by HMAC first. */
export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifyWebhookHmac(raw, request.headers.get("x-shopify-hmac-sha256"))) return new Response("invalid signature", { status: 401 });
  const topic = request.headers.get("x-shopify-topic") ?? "";
  const shop = request.headers.get("x-shopify-shop-domain") ?? "";
  const body = JSON.parse(raw || "{}");
  const conn = await connectionForShop(shop);

  // Privacy (GDPR) topics. We keep no Shopify customer data beyond order numbers on redeemed codes.
  if (topic === "customers/data_request" || topic === "customers/redact") {
    await kv.log({ type: "seller_action", actor: "system", detail: `Shopify ${topic} for ${shop}: no Shopify customer data held` });
    return new Response(null, { status: 200 });
  }
  if (topic === "shop/redact") {
    if (conn) await updateConnection(conn.id, { uninstalledAt: conn.uninstalledAt ?? new Date(), meta: { redactedAt: new Date().toISOString() } });
    return new Response(null, { status: 200 });
  }
  if (!conn?.storeId) return new Response(null, { status: 200 }); // not connected to a GhostCart store yet

  if (topic === "app/uninstalled") {
    await updateConnection(conn.id, { uninstalledAt: new Date() });
    await updateStore(conn.storeId, { status: "draft", reviewNote: "The GhostCart Shopify app was uninstalled. Reinstall it to take orders again." });
  } else if (topic === "products/create" || topic === "products/update") {
    await syncShopifyProductWebhook(conn.storeId, body);
  } else if (topic === "products/delete") {
    await archiveShopifyProduct(conn.storeId, body.id);
  } else if (topic === "orders/create") {
    for (const d of (body.discount_codes ?? []) as { code: string }[]) {
      if (!/^GC-/i.test(d.code)) continue;
      const deal = await redeemGrant({ storeId: conn.storeId, code: d.code.toUpperCase(), platformOrderRef: String(body.name ?? body.id) });
      if (!deal) continue;
      const m = orderMoney({ priceInr: deal.dealPrice, lockFeeInr: 0, feeBps: Number(process.env.PLATFORM_FEE_BPS ?? 200) });
      // Charged through Shopify Billing: move the fee from "owed by the seller" to "billed via Shopify".
      if (await recordShopifyUsage(conn, (m.fee + m.gst) / 100, `GhostCart fee for ${body.name ?? body.id}`)) {
        await post(await getDb(), {
          kind: "fee_billed",
          memo: `shopify usage for ${body.name ?? body.id}`,
          postings: assertBalanced([
            { account: "ghostcart:billing:shopify", amount: m.fee + m.gst },
            { account: accounts.sellerFeesDue(conn.storeId), amount: -(m.fee + m.gst) },
          ]),
        });
      }
    }
  }
  return new Response(null, { status: 200 });
}
