import { schema } from "@ghostcart/db";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { newId } from "./ids";

const { members, orgs } = schema;

export type MemberRole = "owner" | "admin" | "approver" | "viewer";
export type OrgPermission = "manage" | "catalogue" | "approve" | "view";

const GRANTS: Record<MemberRole, readonly OrgPermission[]> = {
  owner: ["manage", "catalogue", "approve", "view"],
  admin: ["catalogue", "approve", "view"],
  approver: ["approve", "view"],
  viewer: ["view"],
};

export const roleCan = (role: MemberRole, permission: OrgPermission) => GRANTS[role].includes(permission);

/** A new seller business with its first member as owner. */
export async function createOrg(input: { name: string; ownerPhone: string; ownerName: string }) {
  const db = await getDb();
  const org = { id: newId("org"), name: input.name.trim().slice(0, 80) };
  await db.insert(orgs).values(org);
  await db.insert(members).values({ orgId: org.id, phone: input.ownerPhone, name: input.ownerName.trim().slice(0, 80), role: "owner" });
  return org;
}

/** Orgs this verified phone number belongs to, with its role in each. */
export async function orgsForPhone(phone: string) {
  const db = await getDb();
  return db
    .select({ id: orgs.id, name: orgs.name, role: members.role })
    .from(members)
    .innerJoin(orgs, eq(orgs.id, members.orgId))
    .where(eq(members.phone, phone)) as Promise<{ id: string; name: string; role: MemberRole }[]>;
}

export async function memberRole(orgId: string, phone: string): Promise<MemberRole | undefined> {
  const db = await getDb();
  const [row] = await db.select({ role: members.role }).from(members).where(and(eq(members.orgId, orgId), eq(members.phone, phone)));
  return row?.role as MemberRole | undefined;
}

/** Who can approve a seller-funded offer, owner first: the numbers the approval call tries. */
export async function approverPhones(orgId: string) {
  const db = await getDb();
  const rows = await db.select({ phone: members.phone, role: members.role, name: members.name }).from(members).where(eq(members.orgId, orgId));
  const rank: Record<string, number> = { owner: 0, admin: 1, approver: 2 };
  return rows.filter((r) => r.role in rank).sort((a, b) => rank[a.role] - rank[b.role]);
}

export async function memberName(orgId: string, phone: string) {
  const db = await getDb();
  const [row] = await db.select({ name: members.name }).from(members).where(and(eq(members.orgId, orgId), eq(members.phone, phone)));
  return row?.name;
}
