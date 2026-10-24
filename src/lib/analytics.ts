import { shortTitle } from "./format";
import type { Activity, Deal, Demographics, User, Visit } from "./types";

export interface Bucket {
  label: string;
  value: number;
}

const IST_HOUR = new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" });
const istHour = (at: number) => Number(IST_HOUR.format(new Date(at))) % 24;

/** Count by label, biggest first; long tails fold into "Other". */
function tally(values: (string | undefined)[], max = 8): Bucket[] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v || "Unknown", (counts.get(v || "Unknown") ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
  if (sorted.length <= max) return sorted;
  const rest = sorted.slice(max - 1).reduce((sum, b) => sum + b.value, 0);
  return [...sorted.slice(0, max - 1), { label: "Other", value: rest }];
}

const cap = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function sourceOf(d?: Demographics) {
  if (d?.source) return d.source;
  if (d?.referrer) return d.referrer;
  return d ? "Direct" : undefined;
}

export function computeAnalytics({ users, deals, activity, visits }: { users: User[]; deals: Deal[]; activity: Activity[]; visits: Visit[] }) {
  const paid = deals.filter((d) => d.status === "paid");
  const escalated = deals.filter((d) => d.negotiation?.approval);
  const decided = escalated.filter((d) => d.negotiation?.approval?.decision);
  const agreed = new Set(activity.filter((a) => a.type === "deal_agreed").map((a) => a.dealId));
  const visitors = new Set(visits.map((v) => v.vid));
  const landingVisitors = new Set(visits.filter((v) => v.path === "/").map((v) => v.vid));
  const shoppersWithDeal = new Set(deals.map((d) => d.userId).filter(Boolean));

  // Time from price agreed to payment, per paid deal.
  const agreedAt = new Map(activity.filter((a) => a.type === "deal_agreed").map((a) => [a.dealId, a.at]));
  const paidAt = new Map(activity.filter((a) => a.type === "payment_received").map((a) => [a.dealId, a.at]));
  const secondsToPay = paid
    .map((d) => (agreedAt.get(d.id) && paidAt.get(d.id) ? (paidAt.get(d.id)! - agreedAt.get(d.id)!) / 1000 : undefined))
    .filter((x): x is number => x !== undefined && x >= 0);

  const decisionSeconds = decided.map((d) => (d.negotiation!.approval!.decidedAt! - d.negotiation!.approval!.requestedAt) / 1000);
  const decisionChannel = (d: Deal) => {
    const by = d.negotiation?.approval?.decidedBy ?? "";
    if (by.includes("(voice)")) return "Phone call (Vobiz)";
    if (d.negotiation?.terms.fundedBy === "seller" && by === d.negotiation?.terms.sellerName) return "Seller dashboard";
    if (by.includes("accepted agent recommendation")) return "Admin, agent's call";
    return "Admin console";
  };
  const withRec = escalated.filter((d) => d.negotiation?.recommendation);
  const recFollowed = decided.filter((d) => {
    const rec = d.negotiation?.recommendation;
    const dec = d.negotiation?.approval?.decision;
    if (!rec || !dec) return false;
    return (rec.decision === "approve" && dec === "approved") || (rec.decision === "reject" && dec === "rejected") || (rec.decision === "counter" && dec === "countered");
  });

  const discountPct = paid.map((d) => ((d.originalPrice - d.dealPrice) / d.originalPrice) * 100).filter((x) => Number.isFinite(x));
  const hours = (ats: number[]) => Array.from({ length: 24 }, (_, h) => ({ label: String(h).padStart(2, "0"), value: ats.filter((at) => istHour(at) === h).length }));

  const demo = users.map((u) => u.demographics);
  const productCounts = tally(deals.map((d) => shortTitle(d.product.title, 4)), 6);

  return {
    generatedAt: Date.now(),
    kpis: {
      visitors: visitors.size,
      shoppers: users.length,
      negotiations: deals.length,
      locked: paid.length,
      gmv: paid.reduce((s, d) => s + d.dealPrice, 0),
      saved: paid.reduce((s, d) => s + d.saved, 0),
      lockRevenue: paid.reduce((s, d) => s + d.lockFee, 0),
      avgDiscountPct: Math.round(avg(discountPct) * 10) / 10,
      avgRounds: Math.round(avg(deals.map((d) => d.negotiation?.rounds ?? 0)) * 10) / 10,
      medianSecondsToPay: secondsToPay.length ? Math.round(secondsToPay.sort((a, b) => a - b)[Math.floor(secondsToPay.length / 2)]) : null,
      visitorToShopperPct: pct(users.length, landingVisitors.size || visitors.size),
      shopperToLockedPct: pct(new Set(paid.map((d) => d.userId)).size, users.length),
      expiredPct: pct(deals.filter((d) => d.status === "expired").length, deals.length),
    },
    funnel: [
      { label: "Visited", value: landingVisitors.size || visitors.size },
      { label: "Signed up", value: users.length },
      { label: "Started a haggle", value: shoppersWithDeal.size },
      { label: "Countered", value: deals.filter((d) => (d.negotiation?.rounds ?? 0) > 0 || d.negotiation?.approval).length },
      { label: "Agreed a price", value: agreed.size },
      { label: "Paid to lock", value: paid.length },
    ],
    demographics: {
      city: tally(demo.map((d, i) => d?.city ?? users[i].city)),
      region: tally(demo.map((d) => d?.region)),
      country: tally(demo.map((d) => d?.country)),
      device: tally(demo.map((d) => cap(d?.device))),
      os: tally(demo.map((d) => d?.os)),
      browser: tally(demo.map((d) => d?.browser)),
      language: tally(demo.map((d) => d?.language)),
      source: tally(demo.map(sourceOf)),
      channel: tally(users.map((u) => (u.channel === "whatsapp" ? "WhatsApp" : "Web"))),
      returning: [
        { label: "Logged back in", value: users.filter((u) => u.lastLoginAt).length },
        { label: "First session only", value: users.filter((u) => !u.lastLoginAt).length },
      ],
      signupHour: hours(users.map((u) => u.createdAt)),
    },
    visitors: {
      device: tally(visits.filter((v) => v.path === "/").map((v) => cap(v.device))),
      city: tally(visits.filter((v) => v.path === "/").map((v) => v.city)),
      pages: tally(visits.map((v) => v.path)),
    },
    commerce: {
      status: tally(deals.map((d) => ({ negotiating: "Haggling", awaiting_approval: "Awaiting approval", pending: "Agreed, unpaid", paid: "Locked", expired: "Expired" })[d.status])),
      category: tally(deals.map((d) => d.negotiation?.terms.category)),
      marketplace: tally(deals.map((d) => d.product.seller)),
      fundedBy: tally(deals.map((d) => (d.negotiation?.terms.fundedBy === "seller" ? "Seller margin" : "GhostCart commission"))),
      topProducts: productCounts,
      dealHour: hours(deals.map((d) => d.createdAt)),
    },
    approvals: {
      escalations: escalated.length,
      escalationRatePct: pct(escalated.length, deals.length),
      decisions: tally(decided.map((d) => ({ approved: "Approved", rejected: "Rejected", countered: "Countered" })[d.negotiation!.approval!.decision!])),
      channel: tally(decided.map(decisionChannel)),
      avgDecisionSeconds: decisionSeconds.length ? Math.round(avg(decisionSeconds)) : null,
      agentReviewedPct: pct(withRec.length, escalated.length),
      humansFollowedAgentPct: pct(recFollowed.length, decided.filter((d) => d.negotiation?.recommendation).length),
      voiceCalls: activity.filter((a) => a.type === "approval_call_placed").length,
    },
  };
}

export type Analytics = ReturnType<typeof computeAnalytics>;
