import type { FulfilmentStage } from "./types";

/** Delivery stages in order, with the shopper-facing label for each. */
export const FULFILMENT_STAGES: { stage: FulfilmentStage; label: string }[] = [
  { stage: "placed", label: "Order placed" },
  { stage: "confirmed", label: "Confirmed by seller" },
  { stage: "shipped", label: "Shipped" },
  { stage: "out_for_delivery", label: "Out for delivery" },
  { stage: "delivered", label: "Delivered" },
];
