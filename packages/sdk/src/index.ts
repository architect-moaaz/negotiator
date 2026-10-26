/**
 * GhostCart negotiation API client. Works in Node 18+, Deno, Bun, edge runtimes and browsers (use the
 * secret key only on a server).
 *
 *   const gc = new GhostCart({ secretKey: process.env.GHOSTCART_SECRET_KEY! });
 *   const s = await gc.sessions.create({ product: "SKU-1", shopper: { id: "cust_42" } });
 *   const next = await gc.sessions.offer(s.id, { text: "can you do 1200?" });
 *   for await (const e of gc.sessions.events(s.id)) console.log(e.type, e.price);
 */

export type SessionStatus = "negotiating" | "awaiting_approval" | "pending" | "paid" | "granted" | "expired";

export interface Session {
  id: string;
  status: SessionStatus;
  product: { id?: string; title: string };
  listPrice: number;
  currentOffer: number;
  agreedPrice: number | null;
  rounds: number;
  awaitingApproval: { price?: number } | null;
  /** The agent's (or seller's) latest words, to show the shopper. */
  reply: string | null;
  messages: { from: "shopper" | "agent" | "seller" | "desk"; text: string; price: number | null; at: string }[];
  expiresAt: string;
  version: number;
  /** Shopify/WooCommerce stores: a single-use code for the seller's own checkout. */
  grant: { code: string; checkoutUrl: string; expiresAt: string } | null;
  /** GhostCart checkout: pay the lock fee by UPI (or send the shopper to url). */
  payment: { lockFee: number; upiIntent: string; url: string; testMode: boolean } | null;
}

export type EventType = "started" | "offer" | "counter" | "hold" | "final" | "escalated" | "approved" | "rejected" | "countered" | "agreed" | "paid" | "address" | "ordered";

export interface SessionEvent {
  id: number;
  type: EventType;
  actor: "shopper" | "agent" | "seller" | "desk" | "system";
  price: number | null;
  status: SessionStatus;
  message: string | null;
  version: number;
  at: string;
}

export interface Product {
  id: string;
  sku: string | null;
  title: string;
  price: number;
  mrp: number | null;
  stock: number;
  status: string;
  images: string[];
}

export class GhostCartError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "GhostCartError";
  }
}

export interface Options {
  secretKey: string;
  /** Defaults to https://ghostcart.app */
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class GhostCart {
  private base: string;
  private key: string;
  private f: typeof fetch;

  constructor(opts: Options) {
    if (!opts.secretKey?.startsWith("gc_sk_")) throw new Error("Pass the store's secret key (gc_sk_…).");
    this.key = opts.secretKey;
    this.base = (opts.baseUrl ?? "https://ghostcart.app").replace(/\/$/, "");
    this.f = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.f(`${this.base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.key}`, Accept: "application/json", ...(body !== undefined && { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new GhostCartError(data.error ?? `HTTP ${res.status}`, res.status);
    return data as T;
  }

  readonly sessions = {
    /** Start a negotiation on a product (SKU or GhostCart id) for one of your shoppers. */
    create: (input: { product: string; shopper: { id: string }; city?: string }) => this.call<Session>("POST", "/api/v1/sessions", input),
    get: (id: string) => this.call<Session>("GET", `/api/v1/sessions/${encodeURIComponent(id)}`),
    /** An offer in rupees, or the shopper's own words. */
    offer: (id: string, offer: { amount: number } | { text: string }) => this.call<Session>("POST", `/api/v1/sessions/${encodeURIComponent(id)}/offers`, offer),
    accept: (id: string) => this.call<Session>("POST", `/api/v1/sessions/${encodeURIComponent(id)}/accept`, {}),
    /**
     * Every step of the negotiation as it happens, oldest first. Reconnects automatically (the server
     * ends each stream after ~50s) and resumes after the last event seen; stop by breaking the loop or
     * aborting the signal.
     */
    events: (id: string, opts: { after?: number; signal?: AbortSignal } = {}) => this.stream(id, opts),
  };

  readonly approvals = {
    /** Decide an offer waiting for the seller's approval. */
    decide: (sessionId: string, decision: { decision: "approved" | "rejected"; by?: string } | { decision: "counter"; price: number; by?: string }) =>
      this.call<Session>("POST", `/api/v1/approvals/${encodeURIComponent(sessionId)}/decision`, decision),
  };

  readonly products = {
    list: () => this.call<{ products: Product[] }>("GET", "/api/v1/products").then((r) => r.products),
    upsert: (products: { sku: string; title: string; price: number; mrp?: number; stock?: number; category?: string; description?: string; images?: string[]; status?: string }[]) =>
      this.call<{ results: { index: number; sku: string | null; id?: string; created?: boolean; error?: string }[] }>("POST", "/api/v1/products", { products }).then((r) => r.results),
  };

  readonly orders = {
    list: (status?: string[]) => this.call<{ orders: Record<string, unknown>[] }>("GET", `/api/v1/orders${status?.length ? `?status=${status.join(",")}` : ""}`).then((r) => r.orders),
  };

  private async *stream(id: string, opts: { after?: number; signal?: AbortSignal }): AsyncGenerator<SessionEvent> {
    let after = opts.after ?? 0;
    while (!opts.signal?.aborted) {
      const res = await this.f(`${this.base}/api/v1/sessions/${encodeURIComponent(id)}/events`, {
        headers: { Authorization: `Bearer ${this.key}`, Accept: "text/event-stream", ...(after && { "Last-Event-ID": String(after) }) },
        signal: opts.signal,
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new GhostCartError(data.error ?? `HTTP ${res.status}`, res.status);
      }
      for await (const e of parseSse(res.body)) {
        after = e.id;
        yield e;
      }
    }
  }
}

/** Parse a text/event-stream body into session events (ignores comments, retry and unknown fields). */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SessionEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      let id = 0;
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("id:")) id = Number(line.slice(3).trim());
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (data) yield { id, ...(JSON.parse(data) as Omit<SessionEvent, "id">) };
    }
  }
}
