import { runNegotiation } from "@/lib/negotiate";
import type { DealInput, NegotiationEvent } from "@/lib/types";

export const maxDuration = 60;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function parseInput(body: { url?: string; imageBase64?: string; mediaType?: string }): DealInput | null {
  if (body.url) {
    const match = body.url.match(/https?:\/\/\S+/);
    return match ? { kind: "url", url: match[0] } : null;
  }
  if (body.imageBase64 && body.mediaType?.startsWith("image/") && body.imageBase64.length * 0.75 < MAX_IMAGE_BYTES) {
    return { kind: "screenshot", imageBase64: body.imageBase64, mediaType: body.mediaType };
  }
  return null;
}

/** Runs the negotiation and streams progress as newline-delimited JSON events. */
export async function POST(request: Request) {
  const input = parseInput(await request.json().catch(() => ({})));
  if (!input) return Response.json({ error: "Send a product URL or a screenshot (max 5MB)" }, { status: 400 });

  const rawCity = request.headers.get("x-vercel-ip-city");
  const city = rawCity ? decodeURIComponent(rawCity) : undefined;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: NegotiationEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        await runNegotiation(input, { city, channel: "web" }, emit);
      } catch (err) {
        console.error("negotiation failed", err);
        emit({ type: "error", message: "Couldn't read that item. Try another link or a clearer screenshot." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
