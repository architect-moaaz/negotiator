# AgenticOrg setup: GhostCart deal-desk agent

The agent lives on AgenticOrg (`https://agenticorg.hackathon.pinelabs.com`) and works through
GhostCart's MCP server. It reviews escalated haggles and recommends approve, reject or counter;
a human (deal desk in `/admin`, or the seller in `/seller`) makes the final call.

## 1. Register the connector

Dashboard → Connectors → New (`/dashboard/connectors/new`)

| Field | Value |
| --- | --- |
| Provider | Custom / Generic Connector |
| Name | `mcp_ghostcart` (must start with `mcp_`) |
| MCP | ✅ tick the MCP checkbox |
| Base URL | `https://ghostcart-topaz.vercel.app/api/mcp` |
| Category | Commerce / Back office |
| Auth type | API key (bearer) |
| API key | the `MCP_TOKEN` value from `ghostcart/.env.production.local` (paste it yourself) |

Run the health check: it should discover 3 tools:
`list_pending_escalations`, `get_deal`, `submit_recommendation`.

## 2. Create the agent

Dashboard → Agents → New (`/dashboard/agents/new`)

- **Name:** GhostCart Deal Desk Agent
- **Designation:** Deal desk analyst
- **Domain:** Back Office (or Commerce if offered)
- **Connectors:** `mcp_ghostcart`
- **HITL condition:** `confidence < 0.9` (every recommendation is also signed off by a human in GhostCart)
- **Prompt:**

```
You are GhostCart's deal-desk analyst. GhostCart lets shoppers haggle live with a seller agent; when a
shopper's offer drops below the agent's auto-approve limit, the deal is escalated to a human. Your job is
to review each escalation and give that human a clear recommendation.

For a given deal id (or, if none is given, every deal from list_pending_escalations):
1. Call get_deal to read the product, best market price, other sellers, floor price, auto-approve limit,
   shopper offer, margin left above the floor and the haggle transcript.
2. Decide:
   - approve if the offer leaves healthy margin above the floor, or the shopper has haggled hard and the
     discount vs market is modest;
   - counter with a price between the shopper's offer and the agent's last offer when margin is thin;
   - reject if the offer is effectively at the floor and the discount vs market is large.
   Factor in the seller's rating and whether the discount is seller-funded or GhostCart-funded.
3. Call submit_recommendation with the decision, counter_price (for counter), a confidence from 0 to 1,
   and one to three sentences of reasoning a busy human can scan.
Never invent prices; use only numbers from get_deal. You recommend; a human decides.
```

Promote the agent out of Shadow mode when it works (`Promote` on the agent page).

## 3. Connect GhostCart to the agent

Copy the agent's id (UUID from its URL) and set these on Vercel, then redeploy:

```bash
vercel env add AGENTICORG_AGENT_ID production
vercel env add AGENTICORG_EMAIL production
vercel env add AGENTICORG_PASSWORD production
```

(If your account can create API keys, set `AGENTICORG_API_KEY` instead of email/password.)

From then on every escalation triggers a review automatically. Without these, the agent can still be run
from the AgenticOrg chat ("Review all pending GhostCart escalations"), and `/admin` → Approvals has an
"Ask AgenticOrg agent" button once configured.

## 4. Demo check

1. Haggle a deal on GhostCart until it escalates.
2. Agent reviews it (automatic, or ask it in AgenticOrg chat).
3. `/admin` → Approvals shows the agent's recommendation; click "Approve agent's call".
4. `/admin` → Agent & payment log shows `agent_recommendation` then `approval_decided` (human).
