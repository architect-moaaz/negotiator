// Shared settings for the k6 scripts. BASE_URL must be a staging deployment, never production.
export const BASE_URL = (__ENV.BASE_URL || "").replace(/\/$/, "");
if (!BASE_URL) throw new Error("Set BASE_URL, e.g. k6 run -e BASE_URL=https://staging.ghostcart.app load/k6/browse.js");
if (/^https:\/\/(www\.)?ghostcart\.app$/.test(BASE_URL) && __ENV.I_KNOW_THIS_IS_PRODUCTION !== "yes") throw new Error("That's production. Load-test staging.");

export const seed = JSON.parse(open("./.seed.json"));

/** What "good" means for every script: 99% of requests succeed, and pages and APIs stay fast at p95. */
export const thresholds = {
  http_req_failed: ["rate<0.01"],
  "http_req_duration{kind:page}": ["p(95)<1200"],
  "http_req_duration{kind:api}": ["p(95)<600"],
};

export const pick = (list) => list[Math.floor(Math.random() * list.length)];
