# Observability

Each part is off until its keys are set, so development and tests send nothing anywhere.

| What | How | Turn it on |
| --- | --- | --- |
| **Errors** (server and browser) | Sentry, via `apps/web/src/instrumentation.ts` (`onRequestError`) and `instrumentation-client.ts`. No user info, cookies, headers, bodies or query strings are sent. | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`; optional `SENTRY_TRACES_SAMPLE_RATE` (default 0.1) |
| **Traces** | OpenTelemetry via `@vercel/otel`. Spans: `agent.choose_move`, `agent.read_intent`, `pinelabs.create_order`, `pinelabs.order_status`, `shopify.graphql`, plus Next's own request spans. Add more with `traced()` from `lib/telemetry.ts`. | On Vercel: enable the OpenTelemetry integration (or Axiom's). Elsewhere: `OTEL_EXPORTER_OTLP_ENDPOINT=https://api.axiom.co` and `OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer <token>,X-Axiom-Dataset=<dataset>` |
| **Logs** | `log(level, msg, fields)` writes one JSON object per line. Never log phone numbers, names or addresses. | Vercel → Integrations → Axiom (log drain) |
| **Product funnel** | PostHog server-side events from the negotiation log: `negotiation_started`, `_offer`, `_escalated`, `_approved`/`_rejected`, `_agreed`, `_paid`, `_ordered`, with channel, store and prices. No cookies or browser script; the distinct id is GhostCart's opaque user id and person profiles are off. | `POSTHOG_KEY`, optional `POSTHOG_HOST` (default EU cloud) |

Shared code: `apps/web/src/lib/telemetry.ts` (`traced`, `log`, `track`).
