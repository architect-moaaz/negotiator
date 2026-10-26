import { ondcConfig } from "@/lib/ondc/config";
import { decryptChallenge } from "@/lib/ondc/crypto";
import { receiveCallback } from "@/lib/ondc/inbound";

/**
 * Our buyer-app endpoint on the ONDC network (ONDC_BAP_URI = <app>/api/ondc):
 * - /on_search, /on_select, /on_init, /on_confirm, /on_status, …: signed callbacks from seller apps.
 * - /on_subscribe: the registry's onboarding challenge.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/ondc/[action]">) {
  const { action } = await ctx.params;
  const raw = await request.text();
  if (action === "on_subscribe") {
    const c = ondcConfig();
    const { challenge } = JSON.parse(raw || "{}") as { challenge?: string };
    if (!challenge || !c.encryptionPrivateKey || !c.registryEncryptionPublicKey) return Response.json({ error: "Not set up for onboarding." }, { status: 400 });
    try {
      return Response.json({ answer: decryptChallenge(challenge, c.encryptionPrivateKey, c.registryEncryptionPublicKey) });
    } catch {
      return Response.json({ error: "Couldn't decrypt the challenge." }, { status: 400 });
    }
  }
  const { status, body } = await receiveCallback(action, raw, request.headers.get("authorization"));
  return Response.json(body, { status, headers: status === 401 ? { "WWW-Authenticate": 'Signature realm="ghostcart",headers="(created) (expires) digest"' } : undefined });
}
