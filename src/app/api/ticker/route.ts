import { store } from "@/lib/store";

/** Server-sent events stream of ticker events for the public dashboard. */
export async function GET() {
  const encoder = new TextEncoder();
  let unsubscribe = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      store.recentTicker().slice().reverse().forEach(send);
      unsubscribe = store.subscribe(send) as () => void;
    },
    cancel() {
      unsubscribe();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
