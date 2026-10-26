/**
 * GhostCart widget. Add to any product page:
 *   <script src="https://<ghostcart>/widget/v1.js" data-key="gc_pk_…" async></script>
 *   <div data-ghostcart-product="YOUR-SKU"></div>
 * Optional on the div: data-label="Make an offer", data-color="#f4b740".
 * On the cart page (GhostCart Privilege), Shopify and WooCommerce read the cart they already show:
 *   <div data-ghostcart-cart="shopify"></div>   or   <div data-ghostcart-cart="woocommerce"></div>
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

interface CartInfo {
  available: boolean;
  url?: string;
  exitPrompt?: boolean;
}

type CartItem = { ref: string; quantity: number };

(() => {
  const script = document.currentScript as HTMLScriptElement | null;
  const key = script?.dataset.key;
  if (!script || !key) {
    console.warn("[GhostCart] Add data-key=\"gc_pk_…\" to the widget script tag.");
    return;
  }
  const base = new URL(script.src).origin;

  function styled(root: ShadowRoot, css: string) {
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
  }

  const buttonCss = (color: string) =>
    `button{font:600 15px/1.2 system-ui,-apple-system,sans-serif;padding:12px 18px;border-radius:10px;border:0;background:${color};color:#1c1a26;cursor:pointer}button:hover{filter:brightness(.96)}button:focus-visible{outline:2px solid #1c1a26;outline-offset:2px}`;

  function open(url: string) {
    const target = new URL(url);
    target.searchParams.set("return", location.href);
    window.open(target.toString(), "_blank", "noopener");
  }

  function render(el: HTMLElement, info: { url?: string }, fallbackLabel: string) {
    const root = el.attachShadow({ mode: "open" });
    const color = /^#[0-9a-f]{3,8}$/i.test(el.dataset.color ?? "") ? el.dataset.color! : "#f4b740";
    styled(root, buttonCss(color));
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("part", "button");
    button.textContent = el.dataset.label || fallbackLabel;
    button.addEventListener("click", () => open(info.url!));
    root.append(button);
  }

  /** The cart as the store itself serves it to this shopper's browser (same origin, their own session). */
  async function readCart(platform: string): Promise<{ items: CartItem[]; cartRef?: string } | null> {
    if (platform === "shopify") {
      const r = await fetch("/cart.js", { credentials: "same-origin", headers: { Accept: "application/json" } });
      if (!r.ok) return null;
      const cart = (await r.json()) as { token?: string; items?: { product_id: number; quantity: number }[] };
      return { items: (cart.items ?? []).map((i) => ({ ref: `shopify-${i.product_id}`, quantity: i.quantity })), cartRef: cart.token?.split("?")[0] };
    }
    if (platform === "woocommerce") {
      const r = await fetch("/wp-json/wc/store/v1/cart", { credentials: "same-origin" });
      if (!r.ok) return null;
      const cart = (await r.json()) as { items?: { id: number; quantity: number }[] };
      return { items: (cart.items ?? []).map((i) => ({ ref: `woo-${i.id}`, quantity: i.quantity })), cartRef: localRef() };
    }
    return null;
  }

  /** A random id for this browser's cart, so revisits update one GhostCart cart instead of making new ones. */
  function localRef() {
    try {
      let ref = localStorage.getItem("ghostcart:cart");
      if (!ref) {
        ref = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
        localStorage.setItem("ghostcart:cart", ref);
      }
      return ref;
    } catch {
      return undefined;
    }
  }

  /**
   * Once per visit on desktop, when the pointer heads for the tab bar, a small card offers the same private
   * offer. No timers or invented scarcity, and it closes for good when dismissed.
   */
  function exitPrompt(info: CartInfo) {
    try {
      if (sessionStorage.getItem("ghostcart:exit") || !matchMedia("(pointer: fine)").matches) return;
    } catch {
      return;
    }
    const onLeave = (e: MouseEvent) => {
      if (e.clientY > 0 || e.relatedTarget) return;
      document.removeEventListener("mouseout", onLeave);
      try {
        sessionStorage.setItem("ghostcart:exit", "1");
      } catch {
        /* still show it once */
      }
      const host = document.createElement("div");
      document.body.append(host);
      const root = host.attachShadow({ mode: "open" });
      styled(
        root,
        `${buttonCss("#f4b740")}.card{position:fixed;right:20px;bottom:20px;z-index:2147483647;max-width:320px;background:#fff;color:#1c1a26;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.25);padding:18px;font:15px/1.4 system-ui,-apple-system,sans-serif}.x{position:absolute;top:6px;right:8px;background:none;padding:6px;font-size:18px}p{margin:0 0 12px}`,
      );
      const card = document.createElement("div");
      card.className = "card";
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-label", "Private offer on your cart");
      const text = document.createElement("p");
      text.textContent = "Leaving? Make this store a private offer on your whole cart. Their agent answers straight away.";
      const go = document.createElement("button");
      go.type = "button";
      go.textContent = "Make an offer";
      go.addEventListener("click", () => {
        open(info.url!);
        host.remove();
      });
      const close = document.createElement("button");
      close.type = "button";
      close.className = "x";
      close.setAttribute("aria-label", "Close");
      close.textContent = "×";
      close.addEventListener("click", () => host.remove());
      card.append(close, text, go);
      root.append(card);
    };
    document.addEventListener("mouseout", onLeave);
  }

  function mountCart(el: HTMLElement) {
    const platform = el.dataset.ghostcartCart ?? "";
    if (el.dataset.ghostcartMounted) return;
    el.dataset.ghostcartMounted = "1";
    readCart(platform)
      .then((cart) =>
        cart?.items.length
          ? fetch(`${base}/api/v1/widget/cart`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ key, cartRef: cart.cartRef, items: cart.items, returnUrl: location.href }),
            }).then((r) => (r.ok ? (r.json() as Promise<CartInfo>) : null))
          : null,
      )
      .then((info) => {
        if (!info?.available || !info.url) return;
        render(el, info, "Make an offer on your cart");
        if (info.exitPrompt) exitPrompt(info);
      })
      .catch(() => undefined); // never break the seller's page
  }

  function mount(el: HTMLElement) {
    const ref = el.dataset.ghostcartProduct;
    if (!ref || el.dataset.ghostcartMounted) return;
    el.dataset.ghostcartMounted = "1";
    fetch(`${base}/api/v1/widget/product?key=${encodeURIComponent(key!)}&ref=${encodeURIComponent(ref)}`)
      .then((r) => (r.ok ? (r.json() as Promise<ProductInfo>) : null))
      .then((info) => {
        if (info?.available && info.haggle && info.url) render(el, info, "Make an offer");
      })
      .catch(() => undefined); // never break the seller's page
  }

  const scan = () => {
    document.querySelectorAll<HTMLElement>("[data-ghostcart-product]").forEach(mount);
    document.querySelectorAll<HTMLElement>("[data-ghostcart-cart]").forEach(mountCart);
  };
  scan();
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
})();
