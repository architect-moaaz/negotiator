import { schema } from "@ghostcart/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { normalizePhone } from "../users";
import { checksFor } from "../verification/service";
import type { Store } from "./stores";

const { orgs, stores } = schema;

export type StoreDisclosure = NonNullable<Store["disclosure"]>;
export class DisclosureError extends Error {}

const disclosureInput = z.object({
  address: z.string().trim().min(5, "Add the street address you trade from.").max(200),
  city: z.string().trim().min(2, "Add the city.").max(60),
  state: z.string().trim().min(2, "Add the state.").max(60),
  pincode: z.string().trim().regex(/^[1-9]\d{5}$/, "A pincode is 6 digits."),
  supportPhone: z.string().trim().min(10, "Add a customer care number."),
  supportEmail: z.union([z.literal(""), z.string().trim().email("That email doesn't look right.")]).optional(),
  returnDays: z.coerce.number({ error: "Return window must be a number of days." }).int().min(0, "Return window can't be negative.").max(30, "Up to 30 days."),
  returnPolicy: z.string().trim().min(20, "Say in a sentence or two what can be returned and how refunds work.").max(2000),
});
export type DisclosureInput = z.input<typeof disclosureInput>;

export async function saveDisclosure(storeId: string, input: DisclosureInput) {
  const r = disclosureInput.safeParse(input);
  if (!r.success) throw new DisclosureError(r.error.issues[0]?.message ?? "Check the details.");
  const supportPhone = normalizePhone(r.data.supportPhone);
  if (!supportPhone) throw new DisclosureError("Use a 10-digit Indian mobile number for customer care.");
  const disclosure: StoreDisclosure = { ...r.data, supportPhone, supportEmail: r.data.supportEmail || undefined };
  const db = await getDb();
  const [row] = await db.update(stores).set({ disclosure }).where(eq(stores.id, storeId)).returning();
  return row?.disclosure ?? null;
}

/**
 * The "sold by" block buyers see on shop and product pages: who the seller legally is, where they are,
 * how to reach them, and the return policy. GSTIN is shown only once a check has passed.
 */
export async function sellerDetails(store: Store) {
  const db = await getDb();
  const [org] = await db.select().from(orgs).where(eq(orgs.id, store.orgId));
  const gstin = (await checksFor(store)).find((c) => c.type === "gstin" && c.status === "passed")?.masked ?? null;
  const d = store.disclosure;
  return {
    legalName: org?.legalName ?? null,
    tradeName: store.name,
    gstin,
    address: d ? `${d.address}, ${d.city}, ${d.state} ${d.pincode}` : null,
    supportPhone: d?.supportPhone ?? null,
    supportEmail: d?.supportEmail ?? null,
    returnDays: d?.returnDays ?? null,
    returnPolicy: d?.returnPolicy ?? null,
  };
}
export type SellerDetails = Awaited<ReturnType<typeof sellerDetails>>;
