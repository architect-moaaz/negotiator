#!/usr/bin/env bash
# Start WordPress + WooCommerce with the GhostCart plugin, ready for the end-to-end test.
set -euo pipefail
cd "$(dirname "$0")"
WOO_VERSION="${WOO_VERSION:-9.9.5}"
wp() { docker compose run --rm -T cli wp "$@"; }

docker compose up -d db wordpress
echo "Waiting for WordPress…"
for _ in $(seq 1 90); do curl -fsS -o /dev/null http://localhost:8080/wp-admin/install.php 2>/dev/null && break; sleep 2; done

wp core install --url=http://localhost:8080 --title="ZZ Woo Shop" --admin_user=admin --admin_password=zz-admin-pass --admin_email=zz-admin@example.test --skip-email
wp rewrite structure '/%postname%/' --hard
wp plugin install woocommerce --version="$WOO_VERSION" --activate
wp plugin activate ghostcart

# A store that's open (no "coming soon"), in India, taking cash on delivery; skip Woo's setup wizard.
wp option update woocommerce_coming_soon no
wp option update woocommerce_currency INR
wp option update woocommerce_default_country IN:KA
wp option update woocommerce_onboarding_profile '{"skipped":true}' --format=json
wp option update woocommerce_cod_settings '{"enabled":"yes","title":"Cash on delivery","description":"Pay on delivery.","instructions":"","enable_for_methods":[],"enable_for_virtual":"yes"}' --format=json

wp wc product create --user=admin --name="ZZ Woo Kettle" --regular_price=2000 --manage_stock=true --stock_quantity=5 --status=publish --porcelain
wp wc product create --user=admin --name="ZZ Woo Lamp" --regular_price=900 --manage_stock=true --stock_quantity=3 --status=publish --porcelain
echo "WooCommerce $WOO_VERSION ready at http://localhost:8080 (admin / zz-admin-pass)."
