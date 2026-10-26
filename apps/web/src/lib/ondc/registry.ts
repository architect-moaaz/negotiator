import { store as kv } from "../store";
import { authorizationHeader } from "./crypto";
import { ondcConfig } from "./config";

interface Subscriber {
  subscriber_id: string;
  ukId: string;
  signing_public_key: string;
  subscriber_url?: string;
  type?: string;
}

/**
 * A network participant's signing key, from the ONDC registry (/v2.0/lookup, itself signed). Cached for an
 * hour; a key that fails to verify triggers one fresh lookup in case the participant rotated it.
 */
export async function lookupSigningKey(subscriberId: string, ukId: string, { fresh = false } = {}) {
  const cacheKey = `ondc:key:${subscriberId}|${ukId}`;
  if (!fresh) {
    const cached = await kv.kvGet<string>(cacheKey);
    if (cached) return cached;
  }
  const c = ondcConfig();
  const body = JSON.stringify({ subscriber_id: subscriberId, ukId });
  const res = await fetch(`${c.registryUrl.replace(/\/$/, "")}/v2.0/lookup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authorizationHeader(body, { subscriberId: c.subscriberId, ukId: c.ukId, privateKey: c.signingPrivateKey }) },
    body,
  });
  if (!res.ok) return null;
  const list = (await res.json()) as Subscriber[];
  const found = list.find((s) => s.subscriber_id === subscriberId && s.ukId === ukId);
  if (!found?.signing_public_key) return null;
  await kv.kvSet(cacheKey, found.signing_public_key, 60 * 60);
  return found.signing_public_key;
}
