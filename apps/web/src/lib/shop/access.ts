import { sessionSubject, sessionTokenFromRequest } from "../session";
import { store as kv } from "../store";
import { maskPhone } from "../users";
import { memberRole, roleCan, type MemberRole, type OrgPermission } from "./orgs";
import { getStore, type Store } from "./stores";

/** Verified phone of the signed-in seller member, if any. */
export function memberPhone(request: Request) {
  return sessionSubject("member", sessionTokenFromRequest("member", request));
}

type Access = { phone: string; store: Store; role: MemberRole; denied?: never } | { denied: Response; phone?: never; store?: never; role?: never };

/** The member may act on this store with this permission, or the response to send instead. */
export async function requireStoreAccess(request: Request, storeId: string, permission: OrgPermission): Promise<Access> {
  const phone = await memberPhone(request);
  if (!phone) return { denied: Response.json({ error: "Sign in with your phone number." }, { status: 401 }) };
  const store = await getStore(storeId);
  const role = store && (await memberRole(store.orgId, phone));
  // Same answer for "no such store" and "not yours", so ids can't be probed.
  if (!store || !role) return { denied: Response.json({ error: "Store not found." }, { status: 404 }) };
  if (!roleCan(role, permission)) return { denied: Response.json({ error: `Your role (${role}) can't do that.` }, { status: 403 }) };
  return { phone, store, role };
}

/** Seller-side audit trail entry, attributed to the member. */
export function logSellerAction(store: Pick<Store, "id" | "name">, phone: string, detail: string) {
  return kv.log({ type: "seller_action", actor: "seller", detail: `${store.name} (${store.id}) · ${maskPhone(phone)}: ${detail}` });
}
