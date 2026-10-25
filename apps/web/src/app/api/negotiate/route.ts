import { failureMessage, runNegotiation } from "@/lib/negotiate";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { requestCity } from "@/lib/request";
import { store } from "@/lib/store";
import { currentUser } from "@/lib/users";
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
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign up to get your deal.", needsSignup: true }, { status: 401 });
  // Each run costs a page read and several model calls.
  const limited = await rateLimit(
    { name: "negotiate:user", id: user.id, max: 20, windowSeconds: 60 * 60 },
    { name: "negotiate:ip", id: clientIp(request), max: 40, windowSeconds: 60 * 60 },
  );
  if (limited) return limited;
  const input = parseInput(await request.json().catch(() => ({})));
  if (!input) return Response.json({ error: "Send a product URL or a screenshot (max 5MB)" }, { status: 400 });

  const city = requestCity(request) ?? user.city;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: NegotiationEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        await runNegotiation(input, { city, channel: "web", userId: user.id }, emit);
      } catch (err) {
        console.error("negotiation failed", err);
        await store.log({ type: "negotiation_failed", actor: "agent", userId: user.id, detail: String(err).slice(0, 300) });
        emit({ type: "error", message: failureMessage(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
