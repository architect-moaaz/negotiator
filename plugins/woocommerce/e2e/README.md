# WooCommerce plugin, end to end

The real GhostCart plugin on a real WordPress + WooCommerce (Docker), talking to GhostCart's real route handlers. A browser does what a seller and a shopper do. CI runs this as the `woocommerce` job.

```bash
plugins/woocommerce/e2e/setup.sh                      # WordPress 6.8 + WooCommerce 9.9.5 at http://localhost:8080
pnpm --filter @ghostcart/web exec playwright install chromium   # once
pnpm --filter @ghostcart/web test:woo
docker compose -f plugins/woocommerce/e2e/docker-compose.yml down -v   # when finished
```

What it checks (`apps/web/src/lib/woocommerce/woocommerce.docker.test.ts`):

1. The seller saves keys and clicks **Connect** in wp-admin. GhostCart verifies the site signs its check (proof of ownership), and both products arrive in GhostCart.
2. "Make an offer" appears on the product page.
3. An agreed price becomes a WooCommerce coupon: single use, that product only, for the agreed discount. The shopper checks out with it (cash on delivery), and the plugin reports the order back to GhostCart.
4. The coupon is refused a second time, and on another product.
5. Coupon requests that are unsigned, signed with the wrong secret, older than five minutes, or for more than the price are rejected.
6. A price change in WooCommerce reaches GhostCart.

Each run starts from a fresh install: the test disconnects the plugin and resets the products first, so it can be rerun against the same WordPress. Set `WOO_VERSION` for `setup.sh` to try another WooCommerce release. The test serves GhostCart on port 3999 (`GC_PORT`), which WordPress reaches as `host.docker.internal`.
