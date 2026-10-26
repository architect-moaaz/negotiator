<?php
// Remove GhostCart's settings when the plugin is deleted. Coupons and order notes stay with the store.
defined( 'WP_UNINSTALL_PLUGIN' ) || exit;
foreach ( array( 'ghostcart_url', 'ghostcart_publishable_key', 'ghostcart_secret_key', 'ghostcart_signing_secret', 'ghostcart_verified' ) as $option ) {
	delete_option( $option );
}
