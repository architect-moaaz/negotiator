import { mockCreateOrder, mockGetOrder, mockPaymentUrl, mockSetStatus, pinelabsMockEnabled } from "@/lib/pinelabs-mock";

type Ctx = { params: Promise<{ path: string[] }> };

const json = (data: unknown, status = 200) => Response.json(data, { status });
const notFound = () => json({ code: "NOT_FOUND", message: "Not found" }, 404);
const authed = (request: Request) => /^Bearer\s+mock-token-/.test(request.headers.get("authorization") ?? "");

/** Pine Labs UAT gateway mock: same paths as https://pluraluat.v2.pinepg.in. */
export async function POST(request: Request, ctx: Ctx) {
  if (!pinelabsMockEnabled) return notFound();
  const path = (await ctx.params).path.join("/");
  const body = await request.json().catch(() => ({}));

  if (path === "api/auth/v1/token") {
    if (!body.client_id || !body.client_secret || body.grant_type !== "client_credentials") return json({ code: "INVALID_REQUEST", message: "Invalid credentials" }, 401);
    return json({ access_token: `mock-token-${crypto.randomUUID()}`, expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
  }
  if (!authed(request)) return json({ code: "UNAUTHORIZED", message: "Invalid access token" }, 401);

  if (path === "api/pay/v1/orders") {
    try {
      const order = await mockCreateOrder(body);
      return json({ data: { order_id: order.order_id, merchant_order_reference: order.merchant_order_reference, status: order.status, order_amount: order.order_amount } });
    } catch (err) {
      return json({ code: "INVALID_REQUEST", message: String(err instanceof Error ? err.message : err) }, 422);
    }
  }

  const pay = path.match(/^api\/pay\/v1\/orders\/([^/]+)\/payments$/);
  if (pay) {
    const order = await mockSetStatus(decodeURIComponent(pay[1]), "PENDING");
    if (!order) return notFound();
    return json({
      data: {
        status: "PENDING",
        challenge_url: mockPaymentUrl(order.order_id),
        integration_mode: "SEAMLESS",
        payments: [{ id: `${order.order_id}-up-1`, status: "PENDING" }],
      },
    });
  }
  return notFound();
}

export async function GET(request: Request, ctx: Ctx) {
  if (!pinelabsMockEnabled) return notFound();
  if (!authed(request)) return json({ code: "UNAUTHORIZED", message: "Invalid access token" }, 401);
  const path = (await ctx.params).path.join("/");
  const m = path.match(/^api\/pay\/v1\/orders\/([^/]+)$/);
  const order = m ? await mockGetOrder(decodeURIComponent(m[1])) : undefined;
  if (!order) return notFound();
  return json({ data: { order_id: order.order_id, merchant_order_reference: order.merchant_order_reference, status: order.status, order_amount: order.order_amount } });
}
