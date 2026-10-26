import { describe, expect, it } from "vitest";
import { GhostCart, GhostCartError, parseSse } from "./index";

const sse = (text: string) => new Response(new Blob([text]).stream(), { headers: { "Content-Type": "text/event-stream" } });

describe("GhostCart SDK", () => {
  it("sends the secret key and turns API errors into GhostCartError", async () => {
    const seen: [string, RequestInit | undefined][] = [];
    const gc = new GhostCart({
      secretKey: "gc_sk_test",
      baseUrl: "https://example.test/",
      fetch: (async (url: string, init?: RequestInit) => {
        seen.push([url, init]);
        return url.endsWith("/offers") ? Response.json({ error: "This deal is pending." }, { status: 409 }) : Response.json({ id: "d1", status: "negotiating" }, { status: 201 });
      }) as typeof fetch,
    });
    expect(await gc.sessions.create({ product: "SKU-1", shopper: { id: "c1" } })).toMatchObject({ id: "d1" });
    expect(seen[0][0]).toBe("https://example.test/api/v1/sessions");
    expect((seen[0][1]?.headers as Record<string, string>).Authorization).toBe("Bearer gc_sk_test");
    await expect(gc.sessions.offer("d1", { amount: 900 })).rejects.toEqual(new GhostCartError("This deal is pending.", 409));
    expect(() => new GhostCart({ secretKey: "gc_pk_nope" })).toThrow("secret key");
  });

  it("parses event streams across chunk boundaries and resumes after the last id", async () => {
    const events = [];
    for await (const e of parseSse(sse('retry: 1000\n\n: ping\n\nid: 7\nevent: offer\ndata: {"type":"offer","price":900}\n\nid: 8\nevent: counter\ndata: {"type":"counter","price":950}\n\n').body!)) events.push(e);
    expect(events).toEqual([
      { id: 7, type: "offer", price: 900 },
      { id: 8, type: "counter", price: 950 },
    ]);

    let calls = 0;
    const lastIds: (string | null)[] = [];
    const gc = new GhostCart({
      secretKey: "gc_sk_test",
      fetch: (async (_url: string, init?: RequestInit) => {
        lastIds.push(new Headers(init?.headers).get("Last-Event-ID"));
        calls++;
        return calls === 1 ? sse('id: 3\ndata: {"type":"started"}\n\n') : sse('id: 4\ndata: {"type":"agreed"}\n\n');
      }) as typeof fetch,
    });
    const got = [];
    for await (const e of gc.sessions.events("d1")) {
      got.push(e.type);
      if (got.length === 2) break;
    }
    expect(got).toEqual(["started", "agreed"]);
    expect(lastIds).toEqual([null, "3"]);
  });
});
