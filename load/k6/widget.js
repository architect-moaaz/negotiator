// The "Make an offer" widget on sellers' sites: every product-page view asks whether the product can be haggled.
import { check } from "k6";
import http from "k6/http";
import { BASE_URL, pick, seed, thresholds } from "./config.js";

export const options = {
  thresholds,
  scenarios: {
    widget: { executor: "constant-arrival-rate", rate: 100, timeUnit: "1s", duration: "3m", preAllocatedVUs: 50, maxVUs: 300 },
  },
};

export default function () {
  const res = http.get(`${BASE_URL}/api/v1/widget/product?key=${seed.widgetKey}&ref=${pick(seed.skus)}`, { headers: { Origin: seed.origin }, tags: { kind: "api" } });
  check(res, { "widget 200": (r) => r.status === 200, "cors for the store's site": (r) => r.headers["Access-Control-Allow-Origin"] === seed.origin });
}
