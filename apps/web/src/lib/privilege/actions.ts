import { recordConsent } from "../privacy/consent";
import { ShopError } from "../shop/negotiation";
import { store as kv } from "../store";
import { RECOVERABLE, updateCart, type CartRow, type CartStatus } from "./carts";
import { resolveInvite, setInviteStatus } from "./invites";
import { startCartNegotiation } from "./negotiation";

/** Whose consent a cart's recovery offer was recorded under (the same subject captureCart used). */
export const consentSubject = (cart: CartRow) => cart.userId ?? cart.phone ?? cart.email ?? cart.id;

/** The shopper opened their private link and wants to make an offer. */
export async function startFromInvite(token: string, userId: string, opts: { city?: string; request?: Request } = {}) {
  const found = await resolveInvite(token);
  if (!found) throw new ShopError("This private offer link isn't valid.", 404);
  if (found.closed) throw new ShopError(found.closed, 409);
  const deal = await startCartNegotiation(found.cart.id, userId, opts);
  if (found.invite.status !== "used") await setInviteStatus(found.invite.id, "used");
  return deal;
}

/**
 * "Stop offers": no more invites for this cart, on any channel, recorded as a withdrawal of the recovery
 * consent. Works without signing in, from the link itself.
 */
export async function stopFromInvite(token: string) {
  const found = await resolveInvite(token);
  if (!found) throw new ShopError("This private offer link isn't valid.", 404);
  const { cart, store } = found;
  if (cart.status === "opted_out") return cart;
  if (!RECOVERABLE.includes(cart.status as CartStatus) && cart.status !== "negotiating") return cart; // already checked out or expired
  const updated = await updateCart(cart.id, { status: "opted_out" });
  if (cart.consentAt) await recordConsent(consentSubject(cart), "recovery_offers", "withdrawn", `Stopped private offers from ${store.name}`, "privilege_link");
  await kv.log({ type: "privilege_opt_out", actor: "user", userId: cart.userId ?? undefined, detail: `Shopper stopped private offers for cart ${cart.id} (${store.name})` });
  return updated ?? cart;
}
