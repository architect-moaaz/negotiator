// Shoppers haggling: start a deal, make two offers, poll it like the deal page does, then accept.
// Offers stay above the seed shop's auto-approve limit, so nothing escalates to a person or places a call.
// The agent's wording uses Claude when ANTHROPIC_API_KEY is set on the target: unset it on staging for big runs.
import { check, sleep } from "k6";
import http from "k6/http";
import exec from "k6/execution";
import { BASE_URL, pick, seed, thresholds } from "./config.js";

export const options = {
  thresholds: { ...thresholds, "checks{step:start}": ["rate>0.99"] },
  scenarios: {
    haggle: {
      executor: "ramping-vus",
      stages: [
        { duration: "1m", target: 20 },
        { duration: "3m", target: 100 },
        { duration: "1m", target: 0 },
      ],
    },
  },
};

const json = (token) => ({ headers: { "Content-Type": "application/json", Cookie: `gc_session=${token}` }, tags: { kind: "api" } });

export default function () {
  // Each iteration is a different shopper, so per-shopper limits (open deals) behave as in real traffic.
  const token = seed.buyerTokens[exec.scenario.iterationInTest % seed.buyerTokens.length];
  const start = http.post(`${BASE_URL}/api/shop/haggle`, JSON.stringify({ productId: pick(seed.productIds) }), json(token));
  if (!check(start, { "started": (r) => r.status === 200 && !!r.json("id") }, { step: "start" })) return;
  const id = start.json("id");

  let deal = http.get(`${BASE_URL}/api/deal?id=${id}`, json(token)).json();
  const list = deal.originalPrice;
  for (const share of [0.93, 0.95]) {
    if (deal.status !== "negotiating") break;
    sleep(2);
    const r = http.post(`${BASE_URL}/api/haggle`, JSON.stringify({ id, offer: Math.ceil(list * share) }), json(token));
    check(r, { "offer accepted by the API": (x) => x.status === 200 }, { step: "offer" });
    if (r.status === 200) deal = r.json();
  }
  for (let i = 0; i < 3; i++) {
    sleep(2);
    check(http.get(`${BASE_URL}/api/deal?id=${id}`, json(token)), { "poll 200": (r) => r.status === 200 }, { step: "poll" });
  }
  if (deal.status === "negotiating") {
    const r = http.post(`${BASE_URL}/api/haggle`, JSON.stringify({ id, accept: true }), json(token));
    check(r, { "agreed": (x) => x.status === 200 && x.json("status") === "pending" }, { step: "accept" });
  }
  sleep(1);
}
