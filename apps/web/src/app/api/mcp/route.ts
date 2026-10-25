import { timingSafeEqual } from "node:crypto";
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { dealBrief, pendingEscalations, recordRecommendation } from "@/lib/deal-desk";
import { HaggleError } from "@/lib/negotiate";
import { store } from "@/lib/store";

export const maxDuration = 30;

const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

/**
 * GhostCart deal-desk tools for the AgenticOrg agent (registered there as a custom MCP connector).
 * The agent reviews escalated haggles and recommends; humans approve in GhostCart.
 */
const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "list_pending_escalations",
      {
        title: "List pending escalations",
        description:
          "List GhostCart negotiations waiting for human approval because the shopper's offer is below the seller agent's auto-approve limit. Returns a brief per deal.",
        inputSchema: z.object({}),
      },
      async () => {
        const deals = await pendingEscalations();
        return json({ count: deals.length, escalations: deals.map(dealBrief) });
      },
    );

    server.registerTool(
      "get_deal",
      {
        title: "Get deal",
        description: "Full brief for one GhostCart negotiation: product, market prices, margin limits, shopper offer and haggle transcript.",
        inputSchema: z.object({ deal_id: z.string().min(4).max(40) }),
      },
      async ({ deal_id }) => {
        const deal = await store.getDeal(deal_id);
        if (!deal?.negotiation) return fail(`No negotiation with id ${deal_id}.`);
        return json(dealBrief(deal));
      },
    );

    server.registerTool(
      "submit_recommendation",
      {
        title: "Submit recommendation",
        description: `Record your recommendation for an escalated deal. A human (GhostCart deal desk or the seller) reviews it and makes the final call.
approve = accept the shopper's offer. reject = decline (shopper gets a final offer at the auto-approve limit). counter = propose a price between the shopper's offer and the agent's last offer.
Weigh margin left above the floor, discount vs the best market price, seller rating, and how hard the shopper haggled.`,
        // Lenient on purpose: AgenticOrg sometimes sends null for unused fields or numbers as strings.
        inputSchema: z.object({
          deal_id: z.string().min(4).max(40),
          decision: z.enum(["approve", "reject", "counter"]),
          counter_price: z.coerce.number().positive().nullish().describe("Required for counter, in rupees; omit or null otherwise"),
          confidence: z.coerce.number().min(0).max(1),
          reasoning: z.string().min(10).max(4000).describe("One to three sentences a busy human can scan"),
        }),
      },
      async ({ deal_id, decision, counter_price, confidence, reasoning }) => {
        const deal = await store.getDeal(deal_id);
        if (!deal) return fail(`No negotiation with id ${deal_id}.`);
        try {
          const rec = await recordRecommendation(deal, { decision, price: counter_price ?? undefined, confidence, reasoning });
          return json({ ok: true, recorded: rec, next: "A human will approve or override this in GhostCart." });
        } catch (err) {
          if (err instanceof HaggleError) return fail(err.message);
          throw err;
        }
      },
    );
  },
  { serverInfo: { name: "ghostcart-deal-desk", version: "1.0.0" } },
);

/** Bearer token (or X-API-Key) shared with the AgenticOrg connector. */
function authorized(request: Request) {
  const token = process.env.MCP_TOKEN;
  if (!token) return false;
  const given =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? request.headers.get("x-api-key") ?? request.headers.get("api-key") ?? "";
  return given.length === token.length && timingSafeEqual(Buffer.from(given), Buffer.from(token));
}

async function guarded(request: Request) {
  if (!authorized(request)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", "WWW-Authenticate": 'Bearer realm="ghostcart"' },
    });
  }
  return handler(request);
}

export { guarded as GET, guarded as POST, guarded as DELETE };
