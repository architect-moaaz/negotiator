import { inr } from "./format";
import type { Move, Negotiation, NegotiationTerms } from "./types";

export const MAX_ROUNDS = 4;
/** Share of the remaining gap to the auto-approve limit the agent concedes in each round. */
const STEP = [0.4, 0.5, 0.6, 1];

/** Moves the agent is allowed to make, in default order of preference. Code sets every number. */
export function candidateMoves(n: Pick<Negotiation, "currentOffer" | "rounds">, terms: NegotiationTerms, offer: number): Move[] {
  const { autoLimit, floor } = terms;
  const lastRound = n.rounds >= (terms.maxRounds ?? MAX_ROUNDS) - 1;
  const next = lastRound
    ? autoLimit
    : Math.max(autoLimit, Math.round(n.currentOffer - (n.currentOffer - autoLimit) * STEP[Math.min(n.rounds, STEP.length - 1)]));
  const concede = (price: number): Move => (price <= autoLimit ? { action: "final", price: autoLimit } : { action: "counter", price });

  if (offer >= n.currentOffer) return [{ action: "accept", price: n.currentOffer }];

  if (offer >= next) {
    const moves: Move[] = [{ action: "accept", price: offer }];
    const mid = Math.round((offer + n.currentOffer) / 2);
    if (!lastRound && mid > offer && mid < n.currentOffer) moves.push(concede(mid));
    return moves;
  }

  if (offer >= autoLimit) {
    const moves: Move[] = [concede(next)];
    if (n.rounds >= 2) moves.push({ action: "accept", price: offer });
    return moves;
  }

  if (offer >= floor) {
    const escalate: Move = { action: "escalate", price: offer };
    // Nothing left to concede, or the shopper has haggled a while: a human decides.
    if (n.currentOffer <= autoLimit || n.rounds >= 2) return [escalate];
    return [concede(next), escalate];
  }

  // Below the floor: GhostCart would lose money.
  if (n.currentOffer <= autoLimit) return [{ action: "hold", price: n.currentOffer }];
  return [concede(next), { action: "hold", price: n.currentOffer }];
}

/**
 * A human already turned this price down: hold at the current offer instead of paging them again.
 * Returns the replacement move and message, or undefined when the move stands.
 */
export function overrideAfterRejection(move: Move, n: Pick<Negotiation, "currentOffer" | "approval">): { move: Move; message: string } | undefined {
  if (move.action !== "escalate" || n.approval?.decision !== "rejected") return undefined;
  return {
    move: { action: "hold", price: n.currentOffer },
    message: `${inr(n.currentOffer)} is my final offer. It's already been reviewed, so I can't go lower. Take it before the deal expires.`,
  };
}

/** Fallback reply when the LLM is unavailable; also the reference wording for each move. */
export function templateMessage(move: Move, offer: number, terms: NegotiationTerms, bestSeller: string) {
  switch (move.action) {
    case "accept":
      return `Deal. ${inr(move.price)} it is, locking your invoice now.`;
    case "counter":
      return terms.benchmarkKind === "list"
        ? `${inr(offer)} is a stretch on a ${inr(terms.benchmark)} list price. I can do ${inr(move.price)}.`
        : `${inr(offer)} is a stretch when the best price anywhere is ${inr(terms.benchmark)} at ${bestSeller}. I can do ${inr(move.price)}.`;
    case "final":
      return `Final answer: ${inr(move.price)}. That's nearly ${terms.fundedBy === "seller" ? "all the margin I'm allowed to give" : "my whole commission"} on the table.`;
    case "hold":
      return `${inr(offer)} would cost me money. I'm staying at ${inr(move.price)}. Come closer and we'll talk.`;
    case "escalate":
      return terms.fundedBy === "seller"
        ? `${inr(offer)} is more than I can approve on my own. Asking ${terms.sellerName} directly, hang tight.`
        : `${inr(offer)} is more than I can approve on my own. Checking with our deal desk, hang tight.`;
  }
}
