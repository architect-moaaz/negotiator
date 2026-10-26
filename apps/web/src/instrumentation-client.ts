// Browser errors to Sentry, only when NEXT_PUBLIC_SENTRY_DSN is set. No session replay, no PII.
import * as Sentry from "@sentry/nextjs";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({ dsn: process.env.NEXT_PUBLIC_SENTRY_DSN, environment: process.env.NEXT_PUBLIC_VERCEL_ENV, tracesSampleRate: 0, dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false } });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
