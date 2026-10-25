// Tests pay through the in-repo Pine Labs mock gateway: its route handler answers the client's fetches,
// so the real payment code path runs without a network.
const BASE = "http://pinelabs.test";
process.env.PINELABS_MODE ??= "mock";
process.env.PINELABS_BASE_URL ??= BASE;
process.env.PINELABS_CLIENT_ID ??= "zz-test-client";
process.env.PINELABS_CLIENT_SECRET ??= "zz-test-secret";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";

const realFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith(BASE)) return realFetch(input, init);
  const gateway = await import("./src/app/api/mock-pinelabs/[...path]/route");
  const path = new URL(url).pathname.replace(/^\//, "").split("/");
  const request = new Request(url, init);
  const ctx = { params: Promise.resolve({ path }) };
  return request.method === "GET" ? gateway.GET(request, ctx) : gateway.POST(request, ctx);
};
