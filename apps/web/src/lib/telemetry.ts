import { SpanStatusCode, trace, type Attributes } from "@opentelemetry/api";
import { PostHog } from "posthog-node";

/**
 * Observability, each part off unless configured:
 * - Traces (OpenTelemetry via @vercel/otel, see instrumentation.ts): spans around the slow, external
 *   calls (Claude, Pine Labs, Shopify). Vercel's collector on Vercel; anywhere else, set
 *   OTEL_EXPORTER_OTLP_ENDPOINT/HEADERS (e.g. Axiom's OTLP endpoint).
 * - Logs: one JSON object per line, which Vercel's Axiom log drain indexes.
 * - Product funnel (PostHog): server-side events from the negotiation log. No cookies, no personal data:
 *   the distinct id is GhostCart's opaque user id (or the deal id).
 */

const tracer = trace.getTracer("ghostcart");

/** Run fn inside a span; records errors and duration. Cheap no-op when tracing isn't registered. */
export async function traced<T>(name: string, attributes: Attributes, fn: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn();
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error)?.message });
      throw err;
    } finally {
      span.end();
    }
  });
}

type Level = "debug" | "info" | "warn" | "error";
/** Structured log line: { level, msg, ...fields, ts }. Never put phone numbers, names or addresses in fields. */
export function log(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ level, msg, ...fields, ts: new Date().toISOString() });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

const g = globalThis as typeof globalThis & { __posthog?: PostHog | null };
function posthog() {
  if (g.__posthog !== undefined) return g.__posthog;
  const key = process.env.POSTHOG_KEY;
  g.__posthog = key ? new PostHog(key, { host: process.env.POSTHOG_HOST ?? "https://eu.i.posthog.com", flushAt: 1, flushInterval: 0, disableGeoip: true }) : null;
  return g.__posthog;
}

/** A funnel event. Awaited with a short timeout so serverless functions don't drop it, and never throws. */
export async function track(event: string, distinctId: string, properties: Record<string, string | number | boolean | null> = {}) {
  const ph = posthog();
  if (!ph) return;
  try {
    await Promise.race([ph.captureImmediate({ distinctId, event, properties: { ...properties, $process_person_profile: false } }), new Promise((r) => setTimeout(r, 1500))]);
  } catch (err) {
    log("warn", "posthog capture failed", { event, error: String(err) });
  }
}
