<?php
/**
 * Plugin Name:       GhostCart for WooCommerce
 * Plugin URI:        https://ghostcart.app
 * Description:       Let shoppers haggle with your own AI sales agent. You set the discount limits; anything bigger comes to you to approve.
 * Version:           0.1.0
 * Requires at least: 6.4
 * Requires PHP:      8.0
 * Requires Plugins:  woocommerce
 * Author:            GhostCart
 * License:           GPL-2.0-or-later
 * Text Domain:       ghostcart
 */

defined( 'ABSPATH' ) || exit;

final class GhostCart_Plugin {
	const OPT_URL      = 'ghostcart_url';
	const OPT_PK       = 'ghostcart_publishable_key';
	const OPT_SK       = 'ghostcart_secret_key';
	const OPT_SIGNING  = 'ghostcart_signing_secret';
	const OPT_VERIFIED = 'ghostcart_verified';
	const OPT_PRIVILEGE = 'ghostcart_privilege';

	/** Shown next to the checkout checkbox; the same wording GhostCart records as the shopper's consent. */
	const PRIVILEGE_WORDING = "If I don't finish checking out, this store can send me one private offer on my cart through GhostCart (email, WhatsApp or a call). I can stop it any time.";

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'admin_menu' ) );
		add_action( 'admin_post_ghostcart_save', array( __CLASS__, 'handle_save' ) );
		add_action( 'admin_post_ghostcart_connect', array( __CLASS__, 'handle_connect' ) );
		add_action( 'admin_post_ghostcart_sync', array( __CLASS__, 'handle_sync' ) );
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
		add_action( 'woocommerce_after_add_to_cart_button', array( __CLASS__, 'render_button' ) );
		add_action( 'wp_footer', array( __CLASS__, 'render_script' ) );
		add_action( 'wp_loaded', array( __CLASS__, 'apply_coupon_from_link' ), 30 );
		add_action( 'woocommerce_new_product', array( __CLASS__, 'sync_product' ) );
		add_action( 'woocommerce_update_product', array( __CLASS__, 'sync_product' ) );
		add_action( 'woocommerce_payment_complete', array( __CLASS__, 'report_order' ) );
		add_action( 'woocommerce_order_status_processing', array( __CLASS__, 'report_order' ) );
		add_action( 'woocommerce_order_status_completed', array( __CLASS__, 'report_order' ) );
		add_action( 'woocommerce_after_cart_table', array( __CLASS__, 'render_cart_mount' ) );
		add_action( 'woocommerce_review_order_before_submit', array( __CLASS__, 'render_privilege_checkbox' ) );
		add_action( 'woocommerce_checkout_create_order', array( __CLASS__, 'save_privilege_consent' ), 10, 2 );
		add_action( 'woocommerce_checkout_order_processed', array( __CLASS__, 'report_checkout' ) );
	}

	/* ---------- Settings ---------- */

	public static function admin_menu() {
		add_submenu_page( 'woocommerce', 'GhostCart', 'GhostCart', 'manage_woocommerce', 'ghostcart', array( __CLASS__, 'settings_page' ) );
	}

	private static function base_url() {
		return untrailingslashit( get_option( self::OPT_URL, 'https://ghostcart.app' ) );
	}

	public static function settings_page() {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}
		$notice   = isset( $_GET['ghostcart_notice'] ) ? sanitize_text_field( wp_unslash( $_GET['ghostcart_notice'] ) ) : '';
		$verified = (bool) get_option( self::OPT_VERIFIED );
		?>
		<div class="wrap">
			<h1>GhostCart</h1>
			<?php if ( $notice ) : ?>
				<div class="notice notice-info"><p><?php echo esc_html( $notice ); ?></p></div>
			<?php endif; ?>
			<p>Create your store in the GhostCart seller dashboard (choose "My store is on WooCommerce"), then copy your keys from <strong>Integrations</strong>.</p>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="ghostcart_save" />
				<?php wp_nonce_field( 'ghostcart_save' ); ?>
				<table class="form-table" role="presentation">
					<tr><th scope="row"><label for="ghostcart_url">GhostCart address</label></th>
						<td><input name="ghostcart_url" id="ghostcart_url" type="url" class="regular-text" value="<?php echo esc_attr( self::base_url() ); ?>" /></td></tr>
					<tr><th scope="row"><label for="ghostcart_pk">Widget key (gc_pk_…)</label></th>
						<td><input name="ghostcart_pk" id="ghostcart_pk" type="text" class="regular-text" value="<?php echo esc_attr( get_option( self::OPT_PK, '' ) ); ?>" /></td></tr>
					<tr><th scope="row"><label for="ghostcart_sk">Secret key (gc_sk_…)</label></th>
						<td><input name="ghostcart_sk" id="ghostcart_sk" type="password" class="regular-text" autocomplete="off" placeholder="<?php echo get_option( self::OPT_SK ) ? esc_attr__( 'Saved. Paste a new one to replace it.', 'ghostcart' ) : ''; ?>" /></td></tr>
					<tr><th scope="row">GhostCart Privilege</th>
						<td><label><input name="ghostcart_privilege" type="checkbox" value="1" <?php checked( (bool) get_option( self::OPT_PRIVILEGE ) ); ?> /> Ask shoppers at checkout if they'd like one private offer on their cart if they don't finish</label>
						<p class="description">Turn on cart recovery and set its discount limits in the GhostCart seller dashboard.</p></td></tr>
				</table>
				<?php submit_button( 'Save keys' ); ?>
			</form>
			<h2>Connection</h2>
			<p><?php echo $verified ? esc_html__( 'Connected and verified. Shoppers see "Make an offer" on your product pages.', 'ghostcart' ) : esc_html__( 'Not connected yet.', 'ghostcart' ); ?></p>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline">
				<input type="hidden" name="action" value="ghostcart_connect" />
				<?php wp_nonce_field( 'ghostcart_connect' ); ?>
				<?php submit_button( $verified ? 'Reconnect' : 'Connect to GhostCart', 'primary', 'submit', false ); ?>
			</form>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline;margin-left:8px">
				<input type="hidden" name="action" value="ghostcart_sync" />
				<?php wp_nonce_field( 'ghostcart_sync' ); ?>
				<?php submit_button( 'Send all products to GhostCart', 'secondary', 'submit', false ); ?>
			</form>
		</div>
		<?php
	}

	private static function back( $message ) {
		wp_safe_redirect( add_query_arg( array( 'page' => 'ghostcart', 'ghostcart_notice' => rawurlencode( $message ) ), admin_url( 'admin.php' ) ) );
		exit;
	}

	public static function handle_save() {
		if ( ! current_user_can( 'manage_woocommerce' ) || ! check_admin_referer( 'ghostcart_save' ) ) {
			wp_die( 'Not allowed.' );
		}
		update_option( self::OPT_URL, esc_url_raw( wp_unslash( $_POST['ghostcart_url'] ?? '' ) ) );
		update_option( self::OPT_PK, sanitize_text_field( wp_unslash( $_POST['ghostcart_pk'] ?? '' ) ) );
		$sk = sanitize_text_field( wp_unslash( $_POST['ghostcart_sk'] ?? '' ) );
		if ( '' !== $sk ) {
			update_option( self::OPT_SK, $sk, false );
		}
		update_option( self::OPT_PRIVILEGE, empty( $_POST['ghostcart_privilege'] ) ? 0 : 1 );
		self::back( 'Keys saved. Now connect to GhostCart.' );
	}

	/* ---------- Calls to GhostCart (with the secret key) ---------- */

	private static function api( $path, $body ) {
		$sk = get_option( self::OPT_SK );
		if ( ! $sk ) {
			return new WP_Error( 'ghostcart_no_key', 'Add your GhostCart secret key first.' );
		}
		$response = wp_remote_post(
			self::base_url() . $path,
			array(
				'timeout' => 15,
				'headers' => array( 'Authorization' => 'Bearer ' . $sk, 'Content-Type' => 'application/json' ),
				'body'    => wp_json_encode( $body ),
			)
		);
		if ( is_wp_error( $response ) ) {
			return $response;
		}
		$data = json_decode( wp_remote_retrieve_body( $response ), true );
		$code = wp_remote_retrieve_response_code( $response );
		if ( $code < 200 || $code >= 300 ) {
			return new WP_Error( 'ghostcart_api', is_array( $data ) && isset( $data['error'] ) ? $data['error'] : 'GhostCart answered ' . $code );
		}
		return $data;
	}

	public static function handle_connect() {
		if ( ! current_user_can( 'manage_woocommerce' ) || ! check_admin_referer( 'ghostcart_connect' ) ) {
			wp_die( 'Not allowed.' );
		}
		$connected = self::api( '/api/v1/woocommerce/connect', array( 'siteUrl' => home_url() ) );
		if ( is_wp_error( $connected ) ) {
			self::back( 'Could not connect: ' . $connected->get_error_message() );
		}
		update_option( self::OPT_SIGNING, $connected['signingSecret'], false );
		// GhostCart now calls this site back and checks the plugin can sign with the new secret.
		$verified = self::api( '/api/v1/woocommerce/verify', array() );
		update_option( self::OPT_VERIFIED, ! is_wp_error( $verified ) && ! empty( $verified['verified'] ) );
		if ( is_wp_error( $verified ) ) {
			self::back( 'Connected, but GhostCart could not verify the site: ' . $verified->get_error_message() );
		}
		$count = self::sync_all();
		self::back( sprintf( 'Connected to %s. %d products sent to GhostCart.', $connected['storeName'], $count ) );
	}

	public static function handle_sync() {
		if ( ! current_user_can( 'manage_woocommerce' ) || ! check_admin_referer( 'ghostcart_sync' ) ) {
			wp_die( 'Not allowed.' );
		}
		self::back( sprintf( '%d products sent to GhostCart.', self::sync_all() ) );
	}

	/* ---------- Catalogue sync ---------- */

	private static function product_payload( $product ) {
		$price   = (float) $product->get_price();
		$regular = (float) $product->get_regular_price();
		$stock   = $product->managing_stock() ? (int) $product->get_stock_quantity() : ( $product->is_in_stock() ? 100 : 0 );
		$image   = $product->get_image_id() ? wp_get_attachment_url( $product->get_image_id() ) : '';
		return array_filter(
			array(
				'sku'         => 'woo-' . $product->get_id(),
				'title'       => wp_strip_all_tags( $product->get_name() ),
				'description' => wp_trim_words( wp_strip_all_tags( $product->get_short_description() ? $product->get_short_description() : $product->get_description() ), 120 ),
				'price'       => (int) round( $price ),
				'mrp'         => $regular > $price ? (int) round( $regular ) : null,
				'stock'       => max( 0, $stock ),
				'images'      => $image ? array( $image ) : array(),
				'status'      => 'publish' === $product->get_status() ? 'active' : 'draft',
			),
			static function ( $v ) {
				return null !== $v;
			}
		);
	}

	public static function sync_product( $product_id ) {
		$product = wc_get_product( $product_id );
		if ( ! $product || ! $product->is_type( 'simple' ) || ! get_option( self::OPT_VERIFIED ) || (float) $product->get_price() < 1 ) {
			return;
		}
		self::api( '/api/v1/products', array( 'products' => array( self::product_payload( $product ) ) ) );
	}

	private static function sync_all() {
		$sent = 0;
		$page = 1;
		do {
			$products = wc_get_products( array( 'type' => 'simple', 'limit' => 200, 'page' => $page, 'status' => array( 'publish', 'draft' ) ) );
			$batch    = array();
			foreach ( $products as $product ) {
				if ( (float) $product->get_price() >= 1 ) {
					$batch[] = self::product_payload( $product );
				}
			}
			if ( $batch ) {
				$result = self::api( '/api/v1/products', array( 'products' => $batch ) );
				if ( ! is_wp_error( $result ) ) {
					$sent += count( $batch );
				}
			}
			++$page;
		} while ( count( $products ) === 200 && $page < 100 );
		return $sent;
	}

	/* ---------- Storefront ---------- */

	public static function render_button() {
		global $product;
		if ( ! get_option( self::OPT_PK ) || ! $product ) {
			return;
		}
		printf( '<div data-ghostcart-product="%s" style="margin-top:12px"></div>', esc_attr( 'woo-' . $product->get_id() ) );
	}

	public static function render_script() {
		$pk = get_option( self::OPT_PK );
		if ( ! $pk || ! function_exists( 'is_product' ) || ! ( is_product() || is_cart() ) ) {
			return;
		}
		printf( '<script src="%s" data-key="%s" async></script>', esc_url( self::base_url() . '/widget/v1.js' ), esc_attr( $pk ) );
	}

	/** "Make an offer on your cart" on the cart page; the widget reads the cart from the Store API. */
	public static function render_cart_mount() {
		if ( get_option( self::OPT_PK ) ) {
			echo '<div data-ghostcart-cart="woocommerce" style="margin:16px 0"></div>';
		}
	}

	/**
	 * Links from GhostCart carry ?ghostcart_coupon=GC-…, and for a whole cart ?ghostcart_items=<id>:<qty>,…
	 * Each item is topped up to its quantity (so reloading the link never doubles it), then the coupon applied.
	 */
	public static function apply_coupon_from_link() {
		if ( empty( $_GET['ghostcart_coupon'] ) || ! function_exists( 'WC' ) || ! WC()->cart ) {
			return;
		}
		$code = strtoupper( sanitize_text_field( wp_unslash( $_GET['ghostcart_coupon'] ) ) );
		if ( ! preg_match( '/^GC-[2-9A-HJ-NP-Z]{8}$/', $code ) ) {
			return;
		}
		$items = isset( $_GET['ghostcart_items'] ) ? self::parse_items( sanitize_text_field( wp_unslash( $_GET['ghostcart_items'] ) ) ) : array();
		foreach ( $items as $product_id => $quantity ) {
			$in_cart = 0;
			$key     = '';
			foreach ( WC()->cart->get_cart() as $cart_key => $line ) {
				if ( (int) $line['product_id'] === $product_id && empty( $line['variation_id'] ) ) {
					$in_cart = (int) $line['quantity'];
					$key     = $cart_key;
					break;
				}
			}
			if ( $key && $in_cart < $quantity ) {
				WC()->cart->set_quantity( $key, $quantity );
			} elseif ( ! $key ) {
				WC()->cart->add_to_cart( $product_id, $quantity );
			}
		}
		if ( ! WC()->cart->has_discount( $code ) ) {
			WC()->cart->apply_coupon( $code );
		}
	}

	/** "12:1,40:2" → array( 12 => 1, 40 => 2 ); at most 20 products, 1–10 of each. */
	private static function parse_items( $raw ) {
		$items = array();
		foreach ( array_slice( explode( ',', (string) $raw ), 0, 20 ) as $pair ) {
			if ( preg_match( '/^(\d+):(\d+)$/', trim( $pair ), $m ) && (int) $m[1] > 0 && (int) $m[2] >= 1 && (int) $m[2] <= 10 ) {
				$items[ (int) $m[1] ] = (int) $m[2];
			}
		}
		return $items;
	}

	/* ---------- Routes GhostCart calls (signed with the site's signing secret) ---------- */

	public static function register_routes() {
		register_rest_route( 'ghostcart/v1', '/verify', array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'route_verify' ), 'permission_callback' => array( __CLASS__, 'signed' ) ) );
		register_rest_route( 'ghostcart/v1', '/coupons', array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'route_coupon' ), 'permission_callback' => array( __CLASS__, 'signed' ) ) );
	}

	/** X-GhostCart-Signature: t=<unix>,v1=<hex hmac-sha256 of "t.body">, within five minutes. */
	public static function signed( WP_REST_Request $request ) {
		$secret = get_option( self::OPT_SIGNING );
		$header = (string) $request->get_header( 'x_ghostcart_signature' );
		if ( ! $secret || ! preg_match( '/^t=(\d+),v1=([0-9a-f]{64})$/', $header, $m ) || abs( time() - (int) $m[1] ) > 300 ) {
			return false;
		}
		return hash_equals( hash_hmac( 'sha256', $m[1] . '.' . $request->get_body(), $secret ), $m[2] );
	}

	public static function route_verify( WP_REST_Request $request ) {
		$nonce = (string) $request->get_param( 'nonce' );
		return rest_ensure_response( array( 'signature' => hash_hmac( 'sha256', $nonce, get_option( self::OPT_SIGNING ) ) ) );
	}

	/** A single-use coupon for one product (or a whole cart), for the price the shopper agreed with GhostCart. */
	public static function route_coupon( WP_REST_Request $request ) {
		if ( is_array( $request->get_param( 'items' ) ) ) {
			return self::cart_coupon( $request );
		}
		$code       = strtoupper( (string) $request->get_param( 'code' ) );
		$product_id = (int) $request->get_param( 'productId' );
		$amount     = (float) $request->get_param( 'amount' );
		$expires    = strtotime( (string) $request->get_param( 'expiresAt' ) );
		$product    = wc_get_product( $product_id );
		if ( ! preg_match( '/^GC-[2-9A-HJ-NP-Z]{8}$/', $code ) || ! $product || $amount <= 0 || $amount >= (float) $product->get_price() || ! $expires ) {
			return new WP_Error( 'ghostcart_bad_coupon', 'Invalid coupon request.', array( 'status' => 400 ) );
		}
		$coupon = new WC_Coupon();
		$coupon->set_code( $code );
		$coupon->set_discount_type( 'fixed_product' );
		$coupon->set_amount( $amount );
		$coupon->set_product_ids( array( $product_id ) );
		$coupon->set_usage_limit( 1 );
		$coupon->set_usage_limit_per_user( 1 );
		$coupon->set_limit_usage_to_x_items( 1 );
		$coupon->set_individual_use( true );
		$coupon->set_date_expires( $expires );
		$coupon->set_description( 'GhostCart negotiated price' );
		$coupon->save();
		$url = add_query_arg( array( 'add-to-cart' => $product_id, 'ghostcart_coupon' => $code ), wc_get_cart_url() );
		return rest_ensure_response( array( 'checkoutUrl' => $url ) );
	}

	/**
	 * GhostCart Privilege: one fixed_cart coupon for the agreed discount on the whole cart. It only applies
	 * to these products and needs the cart to be worth at least their list total, so it can't be used on a
	 * smaller basket.
	 */
	private static function cart_coupon( WP_REST_Request $request ) {
		$code    = strtoupper( (string) $request->get_param( 'code' ) );
		$amount  = (float) $request->get_param( 'amount' );
		$expires = strtotime( (string) $request->get_param( 'expiresAt' ) );
		$raw     = $request->get_param( 'items' );
		$items   = array();
		$total   = 0.0;
		foreach ( array_slice( $raw, 0, 20 ) as $item ) {
			$product_id = is_array( $item ) ? (int) ( $item['productId'] ?? 0 ) : 0;
			$quantity   = is_array( $item ) ? (int) ( $item['quantity'] ?? 0 ) : 0;
			$product    = $product_id ? wc_get_product( $product_id ) : null;
			if ( ! $product || ! $product->is_purchasable() || $quantity < 1 || $quantity > 10 ) {
				return new WP_Error( 'ghostcart_bad_coupon', 'Invalid coupon request.', array( 'status' => 400 ) );
			}
			$items[ $product_id ] = $quantity;
			$total               += (float) $product->get_price() * $quantity;
		}
		if ( ! preg_match( '/^GC-[2-9A-HJ-NP-Z]{8}$/', $code ) || ! $items || count( $items ) !== count( $raw ) || $amount <= 0 || $amount >= $total || ! $expires ) {
			return new WP_Error( 'ghostcart_bad_coupon', 'Invalid coupon request.', array( 'status' => 400 ) );
		}
		$coupon = new WC_Coupon();
		$coupon->set_code( $code );
		$coupon->set_discount_type( 'fixed_cart' );
		$coupon->set_amount( $amount );
		$coupon->set_product_ids( array_keys( $items ) );
		$coupon->set_minimum_amount( $total );
		$coupon->set_usage_limit( 1 );
		$coupon->set_usage_limit_per_user( 1 );
		$coupon->set_individual_use( true );
		$coupon->set_date_expires( $expires );
		$coupon->set_description( 'GhostCart Privilege: negotiated price for a cart' );
		$coupon->save();
		$pairs = array();
		foreach ( $items as $product_id => $quantity ) {
			$pairs[] = $product_id . ':' . $quantity;
		}
		$url = add_query_arg( array( 'ghostcart_coupon' => $code, 'ghostcart_items' => implode( ',', $pairs ) ), wc_get_cart_url() );
		return rest_ensure_response( array( 'checkoutUrl' => $url ) );
	}

	/* ---------- GhostCart Privilege: recovery consent at checkout ---------- */

	public static function render_privilege_checkbox() {
		if ( ! get_option( self::OPT_PRIVILEGE ) || ! get_option( self::OPT_VERIFIED ) ) {
			return;
		}
		// Unticked by default: the shopper opts in.
		printf(
			'<p class="form-row ghostcart-privilege"><label class="woocommerce-form__label woocommerce-form__label-for-checkbox checkbox"><input type="checkbox" class="woocommerce-form__input woocommerce-form__input-checkbox input-checkbox" name="ghostcart_privilege" value="1" /> <span>%s</span></label></p>',
			esc_html( self::PRIVILEGE_WORDING )
		);
	}

	public static function save_privilege_consent( $order, $data ) {
		if ( get_option( self::OPT_PRIVILEGE ) && ! empty( $_POST['ghostcart_privilege'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification -- WooCommerce checks the checkout nonce.
			$order->update_meta_data( '_ghostcart_privilege_consent', time() );
		}
	}

	/**
	 * Tell GhostCart about a checkout as it's placed. Only shoppers who ticked the box are reported with
	 * contact details; if the order is never paid, the seller's recovery settings decide what happens next.
	 */
	public static function report_checkout( $order_id ) {
		$order = wc_get_order( $order_id );
		if ( ! $order || ! $order->get_meta( '_ghostcart_privilege_consent' ) || $order->get_meta( '_ghostcart_checkout_reported' ) ) {
			return;
		}
		$items = array();
		foreach ( $order->get_items() as $item ) {
			if ( $item->get_product_id() && ! $item->get_variation_id() ) {
				$items[] = array( 'ref' => 'woo-' . $item->get_product_id(), 'quantity' => (int) $item->get_quantity() );
			}
		}
		if ( ! $items ) {
			return;
		}
		$result = self::api(
			'/api/v1/woocommerce/checkouts',
			array(
				'externalRef' => (string) $order->get_id(),
				'items'       => $items,
				'email'       => $order->get_billing_email(),
				'phone'       => $order->get_billing_phone(),
				'name'        => trim( $order->get_billing_first_name() . ' ' . $order->get_billing_last_name() ),
				'consent'     => true,
				'returnUrl'   => wc_get_cart_url(),
			)
		);
		if ( ! is_wp_error( $result ) ) {
			$order->update_meta_data( '_ghostcart_checkout_reported', time() );
			$order->save();
		}
	}

	/* ---------- Orders ---------- */

	public static function report_order( $order_id ) {
		$order = wc_get_order( $order_id );
		if ( ! $order ) {
			return;
		}
		// A paid order closes the cart GhostCart was holding for it, so no invite goes out.
		if ( $order->get_meta( '_ghostcart_checkout_reported' ) && ! $order->get_meta( '_ghostcart_checkout_completed' ) ) {
			$done = self::api( '/api/v1/woocommerce/checkouts', array( 'externalRef' => (string) $order->get_id(), 'completed' => true ) );
			if ( ! is_wp_error( $done ) ) {
				$order->update_meta_data( '_ghostcart_checkout_completed', time() );
				$order->save();
			}
		}
		if ( $order->get_meta( '_ghostcart_reported' ) ) {
			return;
		}
		foreach ( $order->get_coupon_codes() as $code ) {
			if ( 0 === stripos( $code, 'GC-' ) ) {
				$result = self::api( '/api/v1/woocommerce/orders', array( 'code' => strtoupper( $code ), 'orderNumber' => (string) $order->get_order_number() ) );
				if ( ! is_wp_error( $result ) ) {
					$order->update_meta_data( '_ghostcart_reported', time() );
					$order->save();
				}
			}
		}
	}
}

GhostCart_Plugin::init();
