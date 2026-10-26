/** A negotiation action that can't happen right now (wrong state, bad offer, a conflicting change); routes answer 409. */
export class HaggleError extends Error {}

/** Someone else changed this deal since it was read; reload it and try again. */
export class DealConflictError extends HaggleError {
  constructor() {
    super("This deal just changed. Refresh and try again.");
  }
}
