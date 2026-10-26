import { timingSafeEqual } from "node:crypto";
import { sessionSubject, sessionTokenFromRequest } from "./session";
import { store } from "./store";
import { maskPhone, normalizePhone } from "./users";

/**
 * GhostCart staff and what each role may do. The roster lives in the STAFF env var until orgs and
 * members move to Postgres: "9876543210:owner:Moaaz, 9123456780:approver:Rajath". Removing someone
 * from the roster locks them out on their next request, even mid-session.
 */
export type StaffRole = "owner" | "approver" | "viewer";
export type Permission = "view" | "pii" | "decide" | "fulfil" | "review" | "finance";

const GRANTS: Record<StaffRole, readonly Permission[]> = {
  owner: ["view", "pii", "decide", "fulfil", "review", "finance"],
  approver: ["view", "pii", "decide", "fulfil", "review"],
  viewer: ["view"],
};

export interface Staff {
  name: string;
  role: StaffRole;
  phone?: string; // absent for the service token
}

export function staffRoster(raw = process.env.STAFF ?? ""): Map<string, Staff> {
  const roster = new Map<string, Staff>();
  for (const entry of raw.split(",")) {
    const [rawPhone, role, ...name] = entry.trim().split(":");
    const phone = rawPhone ? normalizePhone(rawPhone) : null;
    if (!phone || !(role in GRANTS)) continue;
    roster.set(phone, { phone, role: role as StaffRole, name: name.join(":").trim() || maskPhone(phone) });
  }
  return roster;
}

export const can = (staff: Staff, permission: Permission) => GRANTS[staff.role].includes(permission);

/**
 * Deprecated: the shared ADMIN_TOKEN, kept only for scripts (the production E2E check) until they
 * move to a staff session. Every use is audited as "Service token".
 */
function serviceToken(request: Request): Staff | undefined {
  const token = process.env.ADMIN_TOKEN;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!token || given.length !== token.length || !timingSafeEqual(Buffer.from(given), Buffer.from(token))) return undefined;
  return { name: "Service token", role: "owner" };
}

export async function staffFromRequest(request: Request): Promise<Staff | undefined> {
  const phone = await sessionSubject("staff", sessionTokenFromRequest("staff", request));
  if (phone) return staffRoster().get(phone);
  return serviceToken(request);
}

/** Append to the audit trail. Staff actions are always attributed to the signed-in person. */
export function audit(staff: Staff, action: string, dealId?: string) {
  return store.log({ type: "staff_action", actor: "human", dealId, detail: `${staff.name} (${staff.role}) ${action}` });
}

/** Staff with the permission, or the response to send instead (401 not signed in, 403 not allowed). */
export async function requireStaff(request: Request, permission: Permission): Promise<{ staff: Staff; denied?: never } | { staff?: never; denied: Response }> {
  const staff = await staffFromRequest(request);
  if (!staff) return { denied: Response.json({ error: "Log in with your staff number." }, { status: 401 }) };
  if (!can(staff, permission)) {
    await store.log({ type: "staff_denied", actor: "human", detail: `${staff.name} (${staff.role}) was refused "${permission}" on ${new URL(request.url).pathname}` });
    return { denied: Response.json({ error: `Your role (${staff.role}) can't do that.` }, { status: 403 }) };
  }
  return { staff };
}
