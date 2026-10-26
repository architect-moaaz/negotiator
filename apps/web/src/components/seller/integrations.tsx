"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ErrorText, field, secondary } from "./ui";
import { WhatsAppConnect } from "./whatsapp-connect";

interface Key {
  id: string;
  kind: "publishable" | "secret";
  prefix: string;
  allowedOrigins: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
}
interface Endpoint {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  recent: { event: string; status: string; attempts: number; responseCode: number | null; createdAt: string }[];
}

function Snippet({ text }: { text: string }) {
  return <pre className="mt-2 overflow-x-auto rounded-lg bg-panel px-3 py-2 font-receipt text-sm select-all">{text}</pre>;
}

/** Widget keys, server API keys and webhooks for sellers with their own site or systems. */
export function IntegrationsTab({ storeId, domain, platform }: { storeId: string; domain: string | null; platform?: string }) {
  const [keys, setKeys] = useState<Key[]>([]);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [origins, setOrigins] = useState(domain ? `https://${domain}` : "");
  const [revealed, setRevealed] = useState<{ value: string; kind: string } | null>(null);
  const [hookUrl, setHookUrl] = useState("");
  const [hookSecret, setHookSecret] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [k, w] = await Promise.all([api<{ keys: Key[] }>(`/api/seller/stores/${storeId}/keys`), api<{ endpoints: Endpoint[] }>(`/api/seller/stores/${storeId}/webhooks`)]);
    if (k.ok) setKeys(k.data.keys);
    if (w.ok) setEndpoints(w.data.endpoints);
  }, [storeId]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function createKey(kind: "publishable" | "secret") {
    setError("");
    const r = await api<{ value: string }>(`/api/seller/stores/${storeId}/keys`, { body: { kind, origins: origins.split(/[\s,]+/).filter(Boolean) } });
    if (!r.ok) return setError(r.error);
    setRevealed({ value: r.data.value, kind });
    load();
  }
  async function revoke(id: string) {
    await api(`/api/seller/stores/${storeId}/keys?keyId=${id}`, { method: "DELETE" });
    load();
  }
  async function hook(body: Record<string, unknown>) {
    setError("");
    const r = await api<{ secret?: string }>(`/api/seller/stores/${storeId}/webhooks`, { body });
    if (!r.ok) return setError(r.error);
    if (r.data.secret) setHookSecret(r.data.secret);
    load();
  }

  const live = keys.filter((k) => !k.revokedAt);
  const widgetKey = revealed?.kind === "publishable" ? revealed.value : live.find((k) => k.kind === "publishable")?.prefix + "…";
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <div className="mt-6 max-w-3xl space-y-10">
      <ErrorText>{error}</ErrorText>
      {platform === "woocommerce" && (
        <section>
          <h2 className="text-xl font-semibold">WooCommerce plugin</h2>
          <p className="mt-1 text-muted">
            Install it from WordPress → Plugins → Add New → Upload, then paste a widget key and a secret key (below) under WooCommerce → GhostCart and click Connect.
          </p>
          <a href="/api/plugins/woocommerce" className={`${secondary} mt-3 inline-block`}>
            Download the plugin (.zip)
          </a>
        </section>
      )}
      <ChatChannels storeId={storeId} />
      {platform === "amazon" && <AmazonSection storeId={storeId} />}
      {platform === "flipkart" && (
        <section>
          <h2 className="text-xl font-semibold">Flipkart listings</h2>
          <p className="mt-1 text-muted">
            In Flipkart Seller Hub, open Listings, download your listings file and save it as CSV. Then use &quot;Import a CSV&quot; on the Products tab: we read
            Flipkart&apos;s own columns (Seller SKU Id, Product Title, Your Selling Price, MRP, Stock). Re-importing updates products by SKU.
          </p>
        </section>
      )}
      {platform === "shopify" && (
        <section>
          <h2 className="text-xl font-semibold">Shopify</h2>
          <p className="mt-1 text-muted">Your Shopify app manages the widget key and webhooks for you. In your theme editor, turn on the GhostCart app embed and add the &quot;Make an offer&quot; block to product pages.</p>
        </section>
      )}
      <section>
        <h2 className="text-xl font-semibold">Haggle button for your website</h2>
        <p className="mt-1 text-muted">Shoppers tap it on your product page and bargain with your agent on GhostCart. Payment is held until delivery, like your GhostCart shop.</p>
        <label className="mt-4 grid gap-1">
          <span className="text-sm text-muted">Your website address (the button only works there)</span>
          <input value={origins} onChange={(e) => setOrigins(e.target.value)} placeholder="https://yourshop.in" className={field} />
        </label>
        <button onClick={() => createKey("publishable")} className={`${secondary} mt-3`}>
          Create a widget key
        </button>
        {widgetKey && (
          <>
            <p className="mt-4 text-sm text-muted">Add this once, before the closing &lt;/body&gt; tag:</p>
            <Snippet text={`<script src="${origin}/widget/v1.js" data-key="${widgetKey}" async></script>`} />
            <p className="mt-3 text-sm text-muted">Then, on each product page, where the button should appear (use the product&apos;s SKU from your GhostCart catalogue):</p>
            <Snippet text={`<div data-ghostcart-product="YOUR-SKU"></div>`} />
          </>
        )}
      </section>

      <section>
        <h2 className="text-xl font-semibold">API for your systems</h2>
        <p className="mt-1 text-muted">Sync your catalogue (POST /api/v1/products, upsert by SKU) and fetch orders (GET /api/v1/orders) with a secret key.</p>
        <button onClick={() => createKey("secret")} className={`${secondary} mt-3`}>
          Create a secret key
        </button>
        {revealed && (
          <div className="mt-4 rounded-xl border border-saffron/60 p-4">
            <p className="text-sm">Copy this {revealed.kind} key now. We don&apos;t keep it and can&apos;t show it again.</p>
            <Snippet text={revealed.value} />
          </div>
        )}
        {live.length > 0 && (
          <table className="mt-4 w-full text-left text-sm">
            <tbody>
              {live.map((k) => (
                <tr key={k.id} className="border-t border-line">
                  <td className="py-2 pr-3 font-receipt">{k.prefix}…</td>
                  <td className="py-2 pr-3">{k.kind}</td>
                  <td className="py-2 pr-3 text-muted">{k.allowedOrigins.join(", ")}</td>
                  <td className="py-2 pr-3 text-muted">{k.lastUsedAt ? `used ${new Date(k.lastUsedAt).toLocaleDateString("en-IN")}` : "not used yet"}</td>
                  <td className="py-2 text-right">
                    <button onClick={() => revoke(k.id)} className="text-muted underline underline-offset-4 hover:text-alarm">
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="text-xl font-semibold">Webhooks</h2>
        <p className="mt-1 text-muted">We POST order events (placed, shipped, delivered, completed, refunded, cancelled) to your server, signed with a secret.</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <input value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} placeholder="https://yourshop.in/ghostcart/webhook" className={`${field} min-w-72 flex-1`} />
          <button onClick={() => hook({ url: hookUrl })} className={secondary}>
            Add endpoint
          </button>
        </div>
        {hookSecret && (
          <div className="mt-4 rounded-xl border border-saffron/60 p-4">
            <p className="text-sm">
              Signing secret (shown once). Verify the <code>GhostCart-Signature</code> header: HMAC-SHA256 of <code>{"{t}.{body}"}</code> with this secret equals <code>v1</code>.
            </p>
            <Snippet text={hookSecret} />
          </div>
        )}
        {endpoints
          .filter((e) => e.active)
          .map((e) => (
            <article key={e.id} className="mt-4 rounded-xl border border-line p-4">
              <p className="font-receipt text-sm break-all">{e.url}</p>
              <div className="mt-2 flex gap-4 text-sm">
                <button onClick={() => hook({ action: "test", endpointId: e.id })} className="underline underline-offset-4">
                  Send test
                </button>
                <button onClick={() => hook({ action: "remove", endpointId: e.id })} className="text-muted underline underline-offset-4 hover:text-alarm">
                  Remove
                </button>
              </div>
              {e.recent.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm text-muted">
                  {e.recent.map((d, i) => (
                    <li key={i}>
                      {d.event} · <span className={d.status === "delivered" ? "text-paid" : d.status === "failed" ? "text-alarm" : ""}>{d.status}</span>
                      {d.responseCode ? ` (${d.responseCode})` : ""} · {d.attempts} {d.attempts === 1 ? "try" : "tries"}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
      </section>
    </div>
  );
}

interface ConnectionRow {
  platform: string;
  externalId: string;
  imported: number | null;
  importedAt: string | null;
  importing: boolean;
  lastError: string | null;
}

/** Amazon Seller Central: connect with SP-API, then listings import in the background. */
function AmazonSection({ storeId }: { storeId: string }) {
  const [conn, setConn] = useState<ConnectionRow | null | undefined>(undefined);
  useEffect(() => {
    const load = async () => {
      const r = await api<{ connections: ConnectionRow[] }>(`/api/seller/stores/${storeId}/connections`);
      if (r.ok) setConn(r.data.connections.find((c) => c.platform === "amazon") ?? null);
    };
    const first = setTimeout(load, 0);
    const t = setInterval(load, 15000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [storeId]);
  return (
    <section>
      <h2 className="text-xl font-semibold">Amazon Seller Central</h2>
      <p className="mt-1 text-muted">Authorise GhostCart to read your own listings. It also proves the Amazon account is yours. We never change anything on Amazon.</p>
      {conn === undefined ? null : conn ? (
        <p className="mt-3">
          Connected ({conn.externalId}).{" "}
          {conn.importing
            ? "Amazon is preparing your listings report; this can take a few minutes."
            : conn.importedAt
              ? `${conn.imported} listings imported ${new Date(conn.importedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}.`
              : ""}
          {conn.lastError && <span className="block text-alarm">Last import problem: {conn.lastError}</span>}
        </p>
      ) : (
        <a href={`/api/amazon/connect?storeId=${storeId}`} className={`${secondary} mt-3 inline-block`}>
          Connect Amazon Seller Central
        </a>
      )}
      <p className="mt-3 text-sm text-muted">No access to Seller Central? Download your inventory report as a file and use &quot;Import a CSV&quot; on the Products tab instead.</p>
    </section>
  );
}

/** Shoppers haggle with your agent in chat: WhatsApp and Instagram. */
function ChatChannels({ storeId }: { storeId: string }) {
  const [conns, setConns] = useState<ConnectionRow[] | null>(null);
  const load = useCallback(async () => {
    const r = await api<{ connections: ConnectionRow[] }>(`/api/seller/stores/${storeId}/connections`);
    if (r.ok) setConns(r.data.connections);
  }, [storeId]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  const wa = conns?.find((c) => c.platform === "whatsapp");
  const ig = conns?.find((c) => c.platform === "instagram");
  return (
    <section>
      <h2 className="text-xl font-semibold">WhatsApp</h2>
      <p className="mt-1 text-muted">Shoppers message your WhatsApp Business number, pick a product and bargain with your agent there. It uses your own number and your discount rules.</p>
      {wa ? <p className="mt-3">Connected: shoppers can message {wa.externalId === "1099000000001" ? "your test number" : "your number"} to haggle.</p> : conns && <WhatsAppConnect storeId={storeId} onConnected={load} />}
      <h2 className="mt-8 text-xl font-semibold">Instagram</h2>
      <p className="mt-1 text-muted">Shoppers DM your Instagram professional account and bargain with your agent there. Your account must be linked to a Facebook Page.</p>
      {ig ? (
        <p className="mt-3">Connected: shoppers can DM your Instagram to haggle.</p>
      ) : (
        conns && (
          <a href={`/api/instagram/connect?storeId=${storeId}`} className={`${secondary} mt-3 inline-block`}>
            Connect Instagram
          </a>
        )
      )}
    </section>
  );
}
