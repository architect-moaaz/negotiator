import { shopifyGraphql } from "./admin";
import { shopifyConfig } from "./config";
import { tokenOf, updateConnection, type Connection } from "./connections";

/**
 * GhostCart's fee on Shopify is charged through Shopify Billing: one usage-based subscription the
 * merchant approves once, then a usage record per order that used a GhostCart code.
 */
export async function ensureBillingSubscription(conn: Connection, returnUrl: string) {
  if (!shopifyConfig().billing || conn.meta.usageLineItemId) return null;
  const data = await shopifyGraphql<{ appSubscriptionCreate: { confirmationUrl: string; appSubscription: { id: string; lineItems: { id: string }[] } } }>(
    conn.externalId,
    tokenOf(conn),
    `mutation GhostCartBilling($name: String!, $returnUrl: URL!, $lineItems: [AppSubscriptionLineItemInput!]!) {
      appSubscriptionCreate(name: $name, returnUrl: $returnUrl, lineItems: $lineItems) { confirmationUrl appSubscription { id lineItems { id } } userErrors { field message } }
    }`,
    {
      name: "GhostCart negotiation fees",
      returnUrl,
      lineItems: [{ plan: { appUsagePricingDetails: { terms: "2% of each order won by your GhostCart agent, plus GST", cappedAmount: { amount: 10000, currencyCode: "INR" } } } }],
    },
  );
  await updateConnection(conn.id, { meta: { ...conn.meta, subscriptionId: data.appSubscriptionCreate.appSubscription.id, usageLineItemId: data.appSubscriptionCreate.appSubscription.lineItems[0]?.id } });
  return data.appSubscriptionCreate.confirmationUrl;
}

/** Charge the fee for one redeemed grant. Returns false when billing isn't set up (fee stays in fees_due). */
export async function recordShopifyUsage(conn: Connection, amountInr: number, description: string) {
  const lineItemId = conn.meta.usageLineItemId as string | undefined;
  if (!shopifyConfig().billing || !lineItemId) return false;
  await shopifyGraphql(conn.externalId, tokenOf(conn), `mutation GhostCartUsage($id: ID!, $price: MoneyInput!, $description: String!) {
      appUsageRecordCreate(subscriptionLineItemId: $id, price: $price, description: $description) { appUsageRecord { id } userErrors { field message } }
    }`, { id: lineItemId, price: { amount: amountInr.toFixed(2), currencyCode: "INR" }, description });
  return true;
}
