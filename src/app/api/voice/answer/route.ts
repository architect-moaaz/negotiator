import { answerCall, dealForCallback } from "@/lib/voice-calls";

/** Vobiz answer_url: the approver picked up. */
export async function POST(request: Request) {
  const { deal, error } = await dealForCallback(request);
  return error ?? answerCall(deal);
}
