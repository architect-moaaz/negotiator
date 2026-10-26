/**
 * GhostCart as an ONDC buyer app (BAP). Values come from ONDC registry onboarding (staging → pre-prod →
 * production). Development and tests point every URL at the in-repo mock network (/api/mock-ondc).
 */
export function ondcConfig() {
  const e = process.env;
  return {
    subscriberId: e.ONDC_SUBSCRIBER_ID ?? "",
    ukId: e.ONDC_UNIQUE_KEY_ID ?? "",
    /** Where network participants send our callbacks: <app>/api/ondc */
    bapUri: e.ONDC_BAP_URI ?? "",
    registryUrl: e.ONDC_REGISTRY_URL ?? "",
    gatewayUrl: e.ONDC_GATEWAY_URL ?? "",
    signingPrivateKey: e.ONDC_SIGNING_PRIVATE_KEY ?? "",
    signingPublicKey: e.ONDC_SIGNING_PUBLIC_KEY ?? "",
    encryptionPrivateKey: e.ONDC_ENCRYPTION_PRIVATE_KEY ?? "",
    /** The registry's X25519 public key (DER, base64), published per environment, for /on_subscribe. */
    registryEncryptionPublicKey: e.ONDC_REGISTRY_ENCRYPTION_PUBLIC_KEY ?? "",
    domain: e.ONDC_DOMAIN ?? "ONDC:RET10",
    city: e.ONDC_CITY ?? "std:080",
    coreVersion: "1.2.0",
  };
}

export const ondcReady = () => {
  const c = ondcConfig();
  return !!(c.subscriberId && c.ukId && c.bapUri && c.registryUrl && c.gatewayUrl && c.signingPrivateKey);
};
