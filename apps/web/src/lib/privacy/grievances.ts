import { schema } from "@ghostcart/db";
import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { newId } from "../shop/ids";
import { PrivacyError } from "./data";

const { grievances } = schema;

export type Grievance = typeof grievances.$inferSelect;

/** DPDP Rules and the E-Commerce Rules: acknowledge within 48 hours, resolve within a month. */
export const ACKNOWLEDGE_WITHIN_MS = 48 * 60 * 60 * 1000;
export const RESOLVE_WITHIN_MS = 30 * 24 * 60 * 60 * 1000;

export const GRIEVANCE_CATEGORIES = { order: "An order", data_privacy: "My data or privacy", seller: "A seller", payment: "A payment or refund", other: "Something else" } as const;

const grievanceInput = z.object({
  name: z.string().trim().min(2, "Add your name.").max(80),
  contact: z.string().trim().min(5, "Add a phone number or email we can reply to.").max(120),
  category: z.enum(Object.keys(GRIEVANCE_CATEGORIES) as [keyof typeof GRIEVANCE_CATEGORIES], { error: "Pick what it's about." }),
  reference: z.string().trim().max(80).optional(),
  message: z.string().trim().min(10, "Tell us what happened in a sentence or two.").max(4000),
});
export type GrievanceInput = z.input<typeof grievanceInput>;

export async function fileGrievance(input: GrievanceInput, now = new Date()) {
  const r = grievanceInput.safeParse(input);
  if (!r.success) throw new PrivacyError(r.error.issues[0]?.message ?? "Check the form.");
  const db = await getDb();
  const [row] = await db
    .insert(grievances)
    .values({
      id: newId("grv"),
      ...r.data,
      reference: r.data.reference || null,
      acknowledgeBy: new Date(now.getTime() + ACKNOWLEDGE_WITHIN_MS),
      resolveBy: new Date(now.getTime() + RESOLVE_WITHIN_MS),
      createdAt: now,
    })
    .returning();
  return row;
}

/** Open and acknowledged complaints, the soonest deadline first. */
export async function openGrievances() {
  const db = await getDb();
  return db.select().from(grievances).where(inArray(grievances.status, ["open", "acknowledged"])).orderBy(asc(grievances.acknowledgeBy));
}

/** The deadline that matters now, and whether it has passed. */
export function grievanceDue(g: Pick<Grievance, "status" | "acknowledgeBy" | "resolveBy">, now = Date.now()) {
  const by = g.status === "open" ? g.acknowledgeBy : g.resolveBy;
  return { step: g.status === "open" ? ("acknowledge" as const) : ("resolve" as const), by, overdue: by.getTime() < now };
}

export async function acknowledgeGrievance(id: string, staffName: string) {
  const db = await getDb();
  const [row] = await db
    .update(grievances)
    .set({ status: "acknowledged", acknowledgedAt: new Date(), handledBy: staffName })
    .where(eq(grievances.id, id))
    .returning();
  if (!row) throw new PrivacyError("That complaint doesn't exist.", 404);
  return row;
}

export async function resolveGrievance(id: string, response: string, staffName: string) {
  if (response.trim().length < 10) throw new PrivacyError("Write the reply the person will get.");
  const db = await getDb();
  const [existing] = await db.select().from(grievances).where(eq(grievances.id, id));
  if (!existing) throw new PrivacyError("That complaint doesn't exist.", 404);
  if (existing.status === "resolved") throw new PrivacyError("That complaint is already resolved.", 409);
  const now = new Date();
  const [row] = await db
    .update(grievances)
    .set({ status: "resolved", response: response.trim().slice(0, 4000), resolvedAt: now, acknowledgedAt: existing.acknowledgedAt ?? now, handledBy: staffName })
    .where(eq(grievances.id, id))
    .returning();
  return row;
}
