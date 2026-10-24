import type { Activity, Deal, User } from "./types";
import { maskPhone } from "./users";

export interface UserRow {
  id: string;
  name: string;
  phone: string; // masked
  channel: User["channel"];
  city?: string;
  signedUpAt: number;
  logins: number;
  lastLoginAt?: number;
  lastSeenAt?: number;
  deals: number;
  locked: number; // lock fee paid
  bought: number; // balance paid, order placed
  delivered: number;
  spent: number; // INR: lock fees + balances paid
  saved: number; // INR saved on bought orders
}

export interface UserInsights {
  generatedAt: number;
  totals: {
    users: number;
    logins: number;
    loggedInToday: number;
    activeLastHour: number;
    negotiated: number; // users with at least one deal
    locked: number; // users who paid a lock fee
    bought: number; // users with a placed order
    delivered: number;
    lockFees: number;
    orderValue: number;
    saved: number;
  };
  users: UserRow[];
  recentLogins: { at: number; userId?: string; name: string; returning: boolean }[];
}

const startOfTodayIst = (now: number) => {
  const IST = 5.5 * 60 * 60 * 1000;
  return Math.floor((now + IST) / 86_400_000) * 86_400_000 - IST;
};

/** Who logged in and what they did: logins come from signup events, purchases from deals. */
export function userInsights(users: User[], deals: Deal[], activity: Activity[], now = Date.now()): UserInsights {
  const rows = new Map<string, UserRow>(
    users.map((u) => [
      u.id,
      { id: u.id, name: u.name, phone: maskPhone(u.phone), channel: u.channel, city: u.city, signedUpAt: u.createdAt, logins: 0, deals: 0, locked: 0, bought: 0, delivered: 0, spent: 0, saved: 0 },
    ]),
  );

  const logins = activity.filter((a) => a.type === "signup");
  for (const a of activity) {
    const row = a.userId ? rows.get(a.userId) : undefined;
    if (!row) continue;
    row.lastSeenAt = Math.max(row.lastSeenAt ?? 0, a.at);
    if (a.type === "signup") {
      row.logins += 1;
      row.lastLoginAt = Math.max(row.lastLoginAt ?? 0, a.at);
    }
  }

  let lockFees = 0;
  let orderValue = 0;
  let saved = 0;
  for (const d of deals) {
    const row = d.userId ? rows.get(d.userId) : undefined;
    const locked = d.status === "paid";
    const bought = d.checkout?.status === "ordered";
    if (locked) lockFees += d.lockFee;
    if (bought) {
      orderValue += d.dealPrice;
      saved += d.saved;
    }
    if (!row) continue;
    row.deals += 1;
    if (locked) {
      row.locked += 1;
      row.spent += d.lockFee;
    }
    if (bought) {
      row.bought += 1;
      row.spent += d.checkout!.amount;
      row.saved += d.saved;
    }
    if (d.checkout?.tracking?.at(-1)?.stage === "delivered") row.delivered += 1;
  }

  const list = [...rows.values()].sort((a, b) => (b.lastSeenAt ?? b.signedUpAt) - (a.lastSeenAt ?? a.signedUpAt));
  const today = startOfTodayIst(now);
  const names = new Map(users.map((u) => [u.id, u.name]));

  return {
    generatedAt: now,
    totals: {
      users: users.length,
      logins: logins.length,
      loggedInToday: new Set(logins.filter((a) => a.at >= today).map((a) => a.userId)).size,
      activeLastHour: list.filter((r) => (r.lastSeenAt ?? 0) >= now - 3_600_000).length,
      negotiated: list.filter((r) => r.deals > 0).length,
      locked: list.filter((r) => r.locked > 0).length,
      bought: list.filter((r) => r.bought > 0).length,
      delivered: list.filter((r) => r.delivered > 0).length,
      lockFees,
      orderValue,
      saved,
    },
    users: list,
    recentLogins: logins.slice(0, 25).map((a) => ({
      at: a.at,
      userId: a.userId,
      name: (a.userId && names.get(a.userId)) || "Shopper",
      returning: a.detail.includes("signed back in"),
    })),
  };
}
