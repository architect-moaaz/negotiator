import { currentSubject } from "./session";
import type { Deal } from "./types";

/**
 * Whether the current request may act on a deal as its shopper. Web deals belong to the signed-in
 * shopper who started them; WhatsApp deals have no web account, so the private deal link is the key.
 */
export async function canActAsShopper(deal: Deal) {
  if (deal.channel !== "web") return true;
  const userId = await currentSubject("buyer");
  return !!userId && userId === deal.userId;
}
