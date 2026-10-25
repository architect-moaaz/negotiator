// Tests pay through the in-repo Pine Labs mock gateway: its route handler answers the client's fetches,
// so the real payment code path runs without a network.
const BASE = "http://pinelabs.test";
process.env.PINELABS_MODE ??= "mock";
process.env.PINELABS_BASE_URL ??= BASE;
process.env.PINELABS_CLIENT_ID ??= "zz-test-client";
process.env.PINELABS_CLIENT_SECRET ??= "zz-test-secret";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";
const SHOPIFY = "http://shopify.test/api/mock-shopify";
process.env.SHOPIFY_ADMIN_BASE ??= SHOPIFY;
const AMAZON = "http://amazon.test/api/mock-amazon";
for (const k of ["AMAZON_CONSENT_BASE", "AMAZON_LWA_BASE", "AMAZON_SPAPI_BASE"]) process.env[k] ??= AMAZON;

const realFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith(AMAZON)) {
    const mock = await import("./src/app/api/mock-amazon/[...path]/route");
    const request = new Request(url, init);
    const ctx = { params: Promise.resolve({ path: new URL(url).pathname.replace("/api/mock-amazon/", "").split("/") }) };
    return request.method === "GET" ? mock.GET(request, ctx) : mock.POST(request, ctx);
  }
  if (url.startsWith(SHOPIFY)) {
    const mock = await import("./src/app/api/mock-shopify/[...path]/route");
    const request = new Request(url, init);
    const ctx = { params: Promise.resolve({ path: new URL(url).pathname.replace("/api/mock-shopify/", "").split("/") }) };
    return request.method === "GET" ? mock.GET(request, ctx) : mock.POST(request, ctx);
  }
  if (!url.startsWith(BASE)) {
    // Tests never reach the internet: anything else fails like an unreachable host.
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url)) return realFetch(input, init);
    throw new TypeError(`network disabled in tests: ${url}`);
  }
  const gateway = await import("./src/app/api/mock-pinelabs/[...path]/route");
  const path = new URL(url).pathname.replace(/^\//, "").split("/");
  const request = new Request(url, init);
  const ctx = { params: Promise.resolve({ path }) };
  return request.method === "GET" ? gateway.GET(request, ctx) : gateway.POST(request, ctx);
};
