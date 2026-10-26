import { adminBase, shopifyConfig } from "@ghostcart/channels";
import { traced } from "../telemetry";

export class ShopifyError extends Error {}

/** Admin GraphQL. Throws on transport errors, GraphQL errors and mutation userErrors. */
export function shopifyGraphql<T>(shop: string, token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const operation = query.match(/^\s*(query|mutation)\s+(\w+)/)?.[2] ?? "anonymous";
  return traced("shopify.graphql", { "shopify.shop": shop, "graphql.operation": operation }, () => run<T>(shop, token, query, variables));
}

async function run<T>(shop: string, token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${adminBase(shop)}/admin/api/${shopifyConfig().apiVersion}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new ShopifyError(`Shopify ${res.status}`);
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new ShopifyError(body.errors.map((e) => e.message).join("; "));
  const data = body.data as Record<string, { userErrors?: { message: string }[] }> | undefined;
  const userErrors = Object.values(data ?? {}).flatMap((v) => (v && typeof v === "object" && "userErrors" in v ? (v.userErrors ?? []) : []));
  if (userErrors.length) throw new ShopifyError(userErrors.map((e) => e.message).join("; "));
  return body.data as T;
}

/** "gid://shopify/Product/123" → "123" */
export const numericId = (gid: string) => gid.split("/").pop() ?? gid;
