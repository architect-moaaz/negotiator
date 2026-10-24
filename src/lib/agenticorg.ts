import { inr } from "./format";
import { store } from "./store";
import type { Deal } from "./types";

const BASE = (process.env.AGENTICORG_BASE_URL || "https://agenticorg.hackathon.pinelabs.com").replace(/\/$/, "");
const AGENT_ID = process.env.AGENTICORG_AGENT_ID;
const API_KEY = process.env.AGENTICORG_API_KEY;
const EMAIL = process.env.AGENTICORG_EMAIL;
const PASSWORD = process.env.AGENTICORG_PASSWORD;

// Prefer the team login: MCP connectors are scoped to the user who registered them, so API-key
// (org-scoped) runs fail with connector_scope_mismatch.
const USE_SESSION = Boolean(EMAIL && PASSWORD);
export const agenticorgConfigured = Boolean(AGENT_ID && (USE_SESSION || API_KEY));

// Developer accounts on the hackathon tenant can't mint API keys, so fall back to a
// session login: cookie jar + CSRF token echoed in both header and body.
let session: { cookie: string; csrf: string } | null = null;

async function login() {
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`AgenticOrg login failed: ${res.status}`);
  const cookies = res.headers.getSetCookie().map((c) => c.split(";")[0]);
  const csrf = cookies.find((c) => c.startsWith("agenticorg_csrf="))?.split("=")[1] ?? "";
  session = { cookie: cookies.join("; "), csrf: decodeURIComponent(csrf) };
  return session;
}

async function post<T>(path: string, body: Record<string, unknown>, retry = true): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  let payload = body;
  if (!USE_SESSION) headers.Authorization = `Bearer ${API_KEY}`;
  else {
    const s = session ?? (await login());
    headers.Cookie = s.cookie;
    headers["X-CSRF-Token"] = s.csrf;
    payload = { ...body, csrf_token: s.csrf };
  }
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(55000) });
  if ((res.status === 401 || res.status === 403) && retry && USE_SESSION) {
    session = null;
    return post(path, body, false);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`AgenticOrg ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

function reviewTask(deal: Deal) {
  const n = deal.negotiation!;
  return `GhostCart escalation for deal ${deal.id}: a shopper offered ${inr(n.approval!.price)} for "${deal.product.title}", below the seller agent's auto-approve limit of ${inr(n.terms.autoLimit)}. Call get_deal with deal_id "${deal.id}" to review margin, market prices and the haggle, then call submit_recommendation (approve, reject, or counter with a price) with brief reasoning. A human makes the final decision.`;
}

/** Ask the AgenticOrg deal-desk agent to review an escalation; it reports back via our MCP tools. */
export async function requestDealReview(deal: Deal) {
  if (!agenticorgConfigured) throw new Error("AgenticOrg isn't configured (AGENTICORG_AGENT_ID plus API key or login).");
  await store.log({
    type: "agent_review_requested",
    actor: "system",
    userId: deal.userId,
    dealId: deal.id,
    detail: `Asked AgenticOrg deal-desk agent to review ${inr(deal.negotiation!.approval!.price)} offer`,
  });
  const task = reviewTask(deal);
  // Session: the same call as the AgenticOrg "Run Agent" button. API key: the MCP gateway, which
  // dispatches by agent type (works only if the agent's connectors are org-scoped).
  const res = USE_SESSION
    ? await post<Record<string, unknown>>(`/api/v1/agents/${AGENT_ID}/run`, { action: "run", inputs: { task, deal_id: deal.id } })
    : await post<Record<string, unknown>>("/api/v1/mcp/call", {
        name: `agenticorg_${process.env.AGENTICORG_AGENT_TYPE || "ecommerce_seller"}`,
        arguments: { action: "run", inputs: { task, deal_id: deal.id }, context: { agent_id: AGENT_ID } },
      });
  const out = res.output ?? res.result ?? res.answer ?? res.content ?? res.status ?? "";
  const summary = typeof out === "string" ? out : JSON.stringify(out);
  return String(summary).slice(0, 2000);
}
