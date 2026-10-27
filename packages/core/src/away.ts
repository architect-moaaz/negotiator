/**
 * "When I'm away" approval rule: during hours the seller can't answer, offers down to a set discount
 * are approved without them. Never below the floor; the agent's own limits don't change.
 */
export interface AwayRule {
  enabled: boolean;
  /** Most off the list price the rule approves, in %. */
  maxPctOff: number;
  /** IST days the rule is active: 0 = Sunday … 6 = Saturday. */
  days: number[];
  /** IST hours [startHour, endHour) the rule is active; wraps past midnight when end < start. */
  startHour: number;
  endHour: number;
}

export const AWAY_DEFAULTS: AwayRule = { enabled: false, maxPctOff: 0, days: [0, 1, 2, 3, 4, 5, 6], startHour: 21, endHour: 9 };

export function validateAwayRule(r: AwayRule): string[] {
  const e: string[] = [];
  if (!(Number.isFinite(r.maxPctOff) && r.maxPctOff >= 0 && r.maxPctOff <= 90)) e.push("The away discount must be between 0% and 90%.");
  if (!r.days.length || r.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) e.push("Pick at least one day.");
  for (const h of [r.startHour, r.endHour]) if (!Number.isInteger(h) || h < 0 || h > 23) e.push("Hours run from 0 to 23.");
  if (r.startHour === r.endHour) e.push("Start and end hours can't be the same.");
  return e;
}

/** IST day of week and hour for a moment. */
export function istClock(at: Date) {
  const ist = new Date(at.getTime() + 330 * 60_000);
  return { day: ist.getUTCDay(), hour: ist.getUTCHours() };
}

export function awayRuleActive(r: AwayRule, at: Date) {
  if (!r.enabled) return false;
  const { day, hour } = istClock(at);
  if (r.startHour < r.endHour) return r.days.includes(day) && hour >= r.startHour && hour < r.endHour;
  // Overnight (e.g. 21:00 to 09:00): the early-morning part belongs to the previous evening's day.
  if (hour >= r.startHour) return r.days.includes(day);
  if (hour < r.endHour) return r.days.includes((day + 6) % 7);
  return false;
}

/** Would the away rule approve this price right now? */
export function awayRuleApproves(r: AwayRule, at: Date, price: number, terms: { benchmark: number; floor: number }) {
  return awayRuleActive(r, at) && price >= terms.floor && price >= Math.ceil(terms.benchmark * (1 - r.maxPctOff / 100));
}
