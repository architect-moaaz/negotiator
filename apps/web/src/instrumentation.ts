import type { Instrumentation } from "next";

/**
 * Runs once per server instance. Tracing always registers (spans are free without an exporter); Sentry
 * only with SENTRY_DSN. See lib/telemetry.ts and docs/observability.md.
 */
export async function register() {
  const { registerOTel } = await import("@vercel/otel");
  registerOTel({ serviceName: "ghostcart-web" });
  if (process.env.SENTRY_DSN && process.env.NEXT_RUNTIME === "nodejs") {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
      // Requests carry phone numbers and addresses: send the error and stack, nothing about the person.
      dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, genAI: { inputs: false, outputs: false }, databaseQueryData: false },
      // @vercel/otel owns tracing (Vercel collector or OTLP to Axiom); Sentry only reports errors.
      enableOpenTelemetrySetup: false,
    });
  }
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(err, request, context);
};
