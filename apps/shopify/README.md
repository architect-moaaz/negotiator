# GhostCart for Shopify

The server side (OAuth install, webhooks, catalogue sync, discount-code price grants, billing) lives in
`apps/web/src/lib/shopify` and `apps/web/src/app/api/shopify`. This folder holds what the Shopify CLI
deploys to Shopify: the app config and the theme app extension.

## How it works for a merchant
1. Install the GhostCart app from the Shopify admin → OAuth → `/seller/connect/shopify`.
2. Sign in with a phone code and connect the shop to a GhostCart business. Installing proves store
   ownership; products are imported; the widget key is written to the app's metafield.
3. In the theme editor, turn on the **GhostCart widget** app embed and add the **Make an offer** block
   to the product template.
4. A shopper haggles on GhostCart; when they agree, Shopify gets a single-use, product-locked,
   expiring discount code (`discountCodeBasicCreate`) and the shopper lands on a cart link with it applied.
5. `orders/create` reports the code used; GhostCart's fee is charged as a Shopify usage record
   (when `SHOPIFY_BILLING=on`).
6. **GhostCart Privilege** (cart recovery, off until the seller turns it on in GhostCart): add the
   **Offer on cart** block to the cart template, and shoppers can make an offer on the whole cart. One
   code covers every product and the cart link (`/cart/<variant>:<qty>,…?discount=CODE`) refills the
   cart. `checkouts/create` and `checkouts/update` turn checkouts into GhostCart carts; `orders/create`
   closes them. Checkout email and phone are kept only when `SHOPIFY_CHECKOUT_CONTACT=1` and the shopper
   accepted the store's marketing. Keep that off until Shopify grants Protected Customer Data access and
   legal confirms the consent covers a private offer. Until then checkouts are counted, never contacted.

## Setup
- Create the app in the Shopify Partner dashboard; copy the API key and secret into
  `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` on Vercel, and into `client_id` above.
- `shopify app deploy` from this folder pushes the config and the extension.
- Local development runs against the in-repo mock: set `SHOPIFY_ADMIN_BASE=<app>/api/mock-shopify`
  and open `/api/shopify/install?shop=zz-dev.myshopify.com`.

Not yet run against a real Partner development store.
