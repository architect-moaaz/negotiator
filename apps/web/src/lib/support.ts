import { schema } from "@ghostcart/db";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "./db";
import { ACKNOWLEDGE_WITHIN_MS, RESOLVE_WITHIN_MS } from "./privacy/grievances";
import { store as kv } from "./store";

const { disputes, grievances, orders } = schema;

/** Staff aim to decide a buyer's dispute within this long (the payout is frozen meanwhile). */
export const DISPUTE_DECIDE_MS = 7 * 86_400_000;

export interface SupportItem {
  kind: "grievance" | "dispute";
  id: string;
  orderId?: string;
  summary: string;
  openedAt: Date;
  /** The next deadline: acknowledge, then resolve (grievances); decide (disputes). */
  dueAt: Date;
  due: "acknowledge" | "resolve" | "decide";
  overdue: boolean;
  assignee?: string;
}

const assignKey = (kind: string, id: string) => `support:assign:${kind}:${id}`;

/**
 * One inbox for staff: complaints (grievance officer: acknowledge in 48 hours, resolve in a month) and
 * buyer disputes (decide within a week), most urgent first.
 */
export async function supportQueue(now = new Date()): Promise<SupportItem[]> {
  const db = await getDb();
  const [gs, ds] = await Promise.all([
    db.select().from(grievances).where(inArray(grievances.status, ["open", "acknowledged"])),
    db.select({ d: disputes, title: orders.title }).from(disputes).innerJoin(orders, eq(orders.id, disputes.orderId)).where(eq(disputes.status, "open")),
  ]);
  const items: SupportItem[] = [
    ...gs.map((g): SupportItem => {
      const acked = !!g.acknowledgedAt;
      const dueAt = new Date(g.createdAt.getTime() + (acked ? RESOLVE_WITHIN_MS : ACKNOWLEDGE_WITHIN_MS));
      return { kind: "grievance", id: g.id, summary: `${g.category}: ${g.message.slice(0, 140)}`, openedAt: g.createdAt, dueAt, due: acked ? "resolve" : "acknowledge", overdue: dueAt < now };
    }),
    ...ds.map(({ d, title }): SupportItem => {
      const dueAt = new Date(d.createdAt.getTime() + DISPUTE_DECIDE_MS);
      return { kind: "dispute", id: d.id, orderId: d.orderId, summary: `${title}: ${d.reason.replace(/_/g, " ")}. ${d.details.slice(0, 120)}`, openedAt: d.createdAt, dueAt, due: "decide", overdue: dueAt < now };
    }),
  ];
  for (const item of items) item.assignee = (await kv.kvGet<string>(assignKey(item.kind, item.id))) ?? undefined;
  return items.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
}

export async function assignSupport(kind: SupportItem["kind"], id: string, staffName: string | null) {
  if (staffName) await kv.kvSet(assignKey(kind, id), staffName, 90 * 86_400);
  else await kv.kvDel(assignKey(kind, id));
}

/** Replies staff can start from. Plain words; edit before sending. */
export const SAVED_REPLIES = [
  { title: "Acknowledge a complaint", text: "Thanks for telling us. We've logged your complaint and will come back to you with an answer within a few days, and no later than a month." },
  { title: "Asking for photos", text: "Sorry about this. Could you send a photo of the item and the packaging, and the label with the tracking number? That helps us settle it quickly." },
  { title: "Refund agreed", text: "We've refunded you in full. Banks usually take 5 to 7 working days to show it in your account." },
  { title: "Seller's side upheld", text: "We looked at the tracking and the seller's evidence, and the order was delivered as described, so we can't refund it. If you have more information, reply and we'll look again." },
];
