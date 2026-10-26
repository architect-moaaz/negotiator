import { eventsFor } from "@/lib/negotiation-events";
import { handle, sessionFor, storeFromKey } from "@/lib/sessions-api";

export const maxDuration = 60;
const STREAM_MS = 50_000;
const POLL_MS = 1000;
const PING_MS = 15_000;

/**
 * Server-sent events for a session: every step (offers, agent moves, escalation, the seller's decision,
 * agreement, payment, order) as `event: <type>` with JSON data, in order. The stream ends after ~50s
 * with `retry`, and EventSource reconnects with Last-Event-ID to continue exactly where it stopped.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/sessions/[id]/events">) {
  return handle(async () => {
    const store = await storeFromKey(request);
    const deal = await sessionFor(store.id, (await ctx.params).id);
    let after = Number(request.headers.get("last-event-id") ?? new URL(request.url).searchParams.get("after") ?? 0) || 0;
    const enc = new TextEncoder();
    const started = Date.now();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (text: string) => controller.enqueue(enc.encode(text));
        send(`retry: 1000\n\n`);
        let lastPing = Date.now();
        try {
          while (!request.signal.aborted && Date.now() - started < STREAM_MS) {
            for (const e of await eventsFor(deal.id, after)) {
              after = e.id;
              const data = { type: e.type, actor: e.actor, price: e.price, status: e.status, message: e.message, version: e.version, at: e.at };
              send(`id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(data)}\n\n`);
            }
            if (Date.now() - lastPing > PING_MS) {
              send(`: ping\n\n`);
              lastPing = Date.now();
            }
            await new Promise((r) => setTimeout(r, POLL_MS));
          }
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
  });
}
