/**
 * GhostCart widget. Add to any product page:
 *   <script src="https://<ghostcart>/widget/v1.js" data-key="gc_pk_…" async></script>
 *   <div data-ghostcart-product="YOUR-SKU"></div>
 * Optional on the div: data-label="Make an offer", data-color="#f4b740".
 * On a site with a Content-Security-Policy, allow the GhostCart origin in script-src and connect-src.
 * Tested on plain, strict-CSP and Shopify-like pages: `pnpm --filter @ghostcart/widget test:browser`.
 *
 * The button opens GhostCart's own haggle page in a new tab: sign-in and payment run first-party there,
 * so they work in every browser, and nothing about the shopper is read from the seller's page.
 */
interface ProductInfo {
  available: boolean;
  haggle?: boolean;
  url?: string;
}

(() => {
  const script = document.currentScript as HTMLScriptElement | null;
  const key = script?.dataset.key;
  if (!script || !key) {
    console.warn("[GhostCart] Add data-key=\"gc_pk_…\" to the widget script tag.");
    return;
  }
  const base = new URL(script.src).origin;

  function render(el: HTMLElement, info: ProductInfo) {
    const root = el.attachShadow({ mode: "open" });
    const color = /^#[0-9a-f]{3,8}$/i.test(el.dataset.color ?? "") ? el.dataset.color : "#f4b740";
    const css = `button{font:600 15px/1.2 system-ui,-apple-system,sans-serif;padding:12px 18px;border-radius:10px;border:0;background:${color};color:#1c1a26;cursor:pointer}button:hover{filter:brightness(.96)}button:focus-visible{outline:2px solid #1c1a26;outline-offset:2px}`;
    // A constructed stylesheet isn't subject to the page's CSP, so the button keeps its look on stores
    // that forbid inline styles. Older browsers get a <style> element (styled unless CSP blocks it).
    if ("adoptedStyleSheets" in root && "replaceSync" in CSSStyleSheet.prototype) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      root.adoptedStyleSheets = [sheet];
    } else {
      const style = document.createElement("style");
      style.textContent = css;
      root.append(style);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("part", "button");
    button.textContent = el.dataset.label || "Make an offer";
    button.addEventListener("click", () => {
      const target = new URL(info.url!);
      target.searchParams.set("return", location.href);
      window.open(target.toString(), "_blank", "noopener");
    });
    root.append(button);
  }

  function mount(el: HTMLElement) {
    const ref = el.dataset.ghostcartProduct;
    if (!ref || el.dataset.ghostcartMounted) return;
    el.dataset.ghostcartMounted = "1";
    fetch(`${base}/api/v1/widget/product?key=${encodeURIComponent(key!)}&ref=${encodeURIComponent(ref)}`)
      .then((r) => (r.ok ? (r.json() as Promise<ProductInfo>) : null))
      .then((info) => {
        if (info?.available && info.haggle && info.url) render(el, info);
      })
      .catch(() => undefined); // never break the seller's page
  }

  const scan = () => document.querySelectorAll<HTMLElement>("[data-ghostcart-product]").forEach(mount);
  scan();
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
})();
