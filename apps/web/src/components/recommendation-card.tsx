import { inr } from "@/lib/format";
import type { AgentRecommendation } from "@/lib/types";

/** The AgenticOrg deal-desk agent's recommendation, shown to the human who decides. */
export function RecommendationCard({ rec, shopperOffer }: { rec: AgentRecommendation; shopperOffer: number }) {
  const label = rec.decision === "approve" ? `Approve ${inr(shopperOffer)}` : rec.decision === "reject" ? "Reject" : `Counter at ${inr(rec.price ?? 0)}`;
  return (
    <div className="mt-3 rounded-xl border border-line bg-panel/60 p-4">
      <p className="text-sm text-muted">
        AgenticOrg deal-desk agent recommends · {Math.round(rec.confidence * 100)}% confident
      </p>
      <p className="mt-1 font-semibold">{label}</p>
      <p className="mt-1 text-muted">{rec.reasoning}</p>
    </div>
  );
}

export function recommendationButtonLabel(rec: AgentRecommendation, shopperOffer: number) {
  return rec.decision === "approve"
    ? `Approve agent's call: ${inr(shopperOffer)}`
    : rec.decision === "reject"
      ? "Agree with agent: reject"
      : `Agree with agent: counter ${inr(rec.price ?? 0)}`;
}
