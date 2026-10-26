import { resolveTxt } from "node:dns/promises";

/** Is this a public hostname we're willing to look up (no IPs, no localhost)? */
export function isPublicDomain(domain: string) {
  return /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(domain) && !/^(localhost|.*\.local|.*\.internal)$/.test(domain);
}

/** The TXT record or meta tag value a seller publishes to prove they control their domain. */
export const ownershipValue = (token: string) => `ghostcart-verify=${token}`;

/** DNS: a TXT record on the domain containing ghostcart-verify=<token>. */
export async function checkDnsTxt(domain: string, token: string) {
  if (!isPublicDomain(domain)) return false;
  try {
    const records = await resolveTxt(domain);
    return records.some((parts) => parts.join("").trim() === ownershipValue(token));
  } catch {
    return false;
  }
}

/** Meta tag on the home page: <meta name="ghostcart-verification" content="<token>">. Fetches only the seller's own site. */
export async function checkMetaTag(domain: string, token: string, fetcher: typeof fetch = fetch) {
  if (!isPublicDomain(domain)) return false;
  try {
    const res = await fetcher(`https://${domain}/`, { redirect: "follow", signal: AbortSignal.timeout(8000), headers: { "User-Agent": "GhostCart-Verification/1.0 (+https://ghostcart.app)" } });
    const finalHost = new URL(res.url || `https://${domain}/`).hostname.replace(/^www\./, "");
    if (!res.ok || (finalHost !== domain && !finalHost.endsWith(`.${domain}`))) return false;
    const html = (await res.text()).slice(0, 200_000);
    return [...html.matchAll(/<meta\s[^>]*>/gi)].some(
      ([tag]) => /name=["']ghostcart-verification["']/i.test(tag) && new RegExp(`content=["']${token}["']`).test(tag),
    );
  } catch {
    return false;
  }
}
