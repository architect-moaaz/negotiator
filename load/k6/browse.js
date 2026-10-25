// Shoppers browsing: home, search, the shop and product pages. Pages render per request (live stock and prices).
import { check, sleep } from "k6";
import http from "k6/http";
import { BASE_URL, pick, seed, thresholds } from "./config.js";

export const options = {
  thresholds,
  scenarios: {
    browse: {
      executor: "ramping-vus",
      stages: [
        { duration: "1m", target: 50 },
        { duration: "3m", target: 200 },
        { duration: "1m", target: 0 },
      ],
    },
  },
};

const QUERIES = ["load item", "zz", "kettle", "phone", "item 7"];

export default function () {
  const page = { tags: { kind: "page" } };
  check(http.get(`${BASE_URL}/`, page), { "home 200": (r) => r.status === 200 });
  sleep(1);
  check(http.get(`${BASE_URL}/search?q=${encodeURIComponent(pick(QUERIES))}`, page), { "search 200": (r) => r.status === 200 });
  sleep(1);
  check(http.get(`${BASE_URL}/s/${seed.slug}`, page), { "shop 200": (r) => r.status === 200 });
  sleep(1);
  check(http.get(`${BASE_URL}/s/${seed.slug}/${pick(seed.productIds)}`, page), { "product 200": (r) => r.status === 200 });
  sleep(2);
}
