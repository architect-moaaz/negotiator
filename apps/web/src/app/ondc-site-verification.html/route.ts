import { ondcConfig } from "@/lib/ondc/config";
import { signRequestId } from "@/lib/ondc/crypto";

/**
 * ONDC registry onboarding looks for this page on our domain: a meta tag holding the request id we
 * submitted (ONDC_SITE_REQUEST_ID), signed with our signing key.
 */
export function GET() {
  const c = ondcConfig();
  const requestId = process.env.ONDC_SITE_REQUEST_ID;
  if (!requestId || !c.signingPrivateKey) return new Response("Not found", { status: 404 });
  const html = `<!doctype html><html><head><meta name="ondc-site-verification" content="${signRequestId(requestId, c.signingPrivateKey)}" /></head><body>ONDC site verification</body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
