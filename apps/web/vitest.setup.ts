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
const META = "http://meta.test/api/mock-meta";
process.env.META_GRAPH_BASE ??= META;

// ONDC: the in-repo mock network, which calls our buyer-app endpoint back on ondc-bap.test.
const ONDC = "http://ondc.test/api/mock-ondc";
const ONDC_BAP = "http://ondc-bap.test/api/ondc";
process.env.ONDC_REGISTRY_URL ??= `${ONDC}/registry`;
process.env.ONDC_GATEWAY_URL ??= `${ONDC}/gateway`;
process.env.ONDC_BAP_URI ??= ONDC_BAP;
process.env.ONDC_SUBSCRIBER_ID ??= "zz-ghostcart.ondc.test";
process.env.ONDC_UNIQUE_KEY_ID ??= "zz-uk-1";
if (!process.env.ONDC_SIGNING_PRIVATE_KEY) {
  const { generateSigningKeys } = await import("./src/lib/ondc/crypto");
  const keys = generateSigningKeys();
  process.env.ONDC_SIGNING_PRIVATE_KEY = keys.privateKey;
  process.env.ONDC_SIGNING_PUBLIC_KEY = keys.publicKey;
}

// Flipkart Seller APIs: the in-repo mock.
const FLIPKART = "http://flipkart.test/api/mock-flipkart";
process.env.FLIPKART_AUTH_BASE ??= `${FLIPKART}/oauth-service`;
process.env.FLIPKART_API_BASE ??= `${FLIPKART}/sellers`;

// WhatsApp through a BSP: the in-repo Gupshup mock.
const GUPSHUP = "http://gupshup.test/api/mock-gupshup";
process.env.GUPSHUP_API_BASE ??= GUPSHUP;

// Push notifications go to the in-repo Expo push mock.
const EXPO = "http://expo.test/api/mock-expo-push";
process.env.EXPO_PUSH_URL ??= EXPO;

const realFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith(FLIPKART)) {
    const mock = await import("./src/app/api/mock-flipkart/[...path]/route");
    return mock.GET(new Request(url, init), { params: Promise.resolve({ path: new URL(url).pathname.replace("/api/mock-flipkart/", "").split("/") }) });
  }
  if (url.startsWith(`${GUPSHUP}/wa/api/v1/template/msg`)) {
    const mock = await import("./src/app/api/mock-gupshup/wa/api/v1/template/msg/route");
    return mock.POST(new Request(url, init));
  }
  if (url.startsWith(GUPSHUP)) {
    const mock = await import("./src/app/api/mock-gupshup/wa/api/v1/msg/route");
    return init?.method === "POST" ? mock.POST(new Request(url, init)) : mock.GET();
  }
  if (url.startsWith(EXPO)) {
    const mock = await import("./src/app/api/mock-expo-push/route");
    return init?.method === "POST" ? mock.POST(new Request(url, init)) : mock.GET();
  }
  if (url.startsWith(ONDC) || url.startsWith(ONDC_BAP)) {
    const request = new Request(url, init);
    const path = new URL(url).pathname;
    if (url.startsWith(ONDC)) {
      const mock = await import("./src/app/api/mock-ondc/[...path]/route");
      return mock.POST(request, { params: Promise.resolve({ path: path.replace("/api/mock-ondc/", "").split("/") }) });
    }
    const bap = await import("./src/app/api/ondc/[action]/route");
    return bap.POST(request, { params: Promise.resolve({ action: path.split("/").pop()! }) } as never);
  }
  if (url.startsWith(META)) {
    const mock = await import("./src/app/api/mock-meta/[...path]/route");
    const request = new Request(url, init);
    const ctx = { params: Promise.resolve({ path: new URL(url).pathname.replace("/api/mock-meta/", "").split("/") }) };
    return request.method === "GET" ? mock.GET(request, ctx) : mock.POST(request, ctx);
  }
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

export {};
