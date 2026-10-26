=== GhostCart for WooCommerce ===
Contributors: ghostcart
Tags: woocommerce, negotiation, offers, discounts, haggle
Requires at least: 6.4
Tested up to: 6.8
Requires PHP: 8.0
Stable tag: 0.1.0
License: GPLv2 or later

Let shoppers haggle with your own AI sales agent, within the discount limits you set.

== Description ==

GhostCart adds a "Make an offer" button to your product pages. Shoppers bargain with your agent on
GhostCart; it gives discounts only within the limits you set per store, category or product, and
anything bigger comes to you to approve. When you agree, the shopper gets a single-use coupon for that
product and pays on your own WooCommerce checkout.

This plugin connects to the GhostCart service (https://ghostcart.app). It sends your product names,
prices, stock and images to GhostCart so the agent knows what it's selling, creates GhostCart coupons on
your store when a price is agreed, and tells GhostCart which orders used them so its fee can be invoiced.
See the GhostCart terms and privacy policy.

== Installation ==

1. In the GhostCart seller dashboard, create a store and choose "My store is on WooCommerce".
2. Under Integrations, create a widget key and a secret key.
3. Install this plugin, open WooCommerce → GhostCart, paste both keys and click "Connect to GhostCart".
4. GhostCart verifies your site and imports your products. "Make an offer" appears on product pages.

== Changelog ==

= 0.1.0 =
* First release: connect and verify, catalogue sync, offer button, coupons for agreed prices, order reporting.
