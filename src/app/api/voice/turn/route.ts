import { callTurn, dealForCallback } from "@/lib/voice-calls";

export const maxDuration = 15;

/** Vobiz Gather action: the approver spoke or pressed a key. */
export async function POST(request: Request) {
  const { deal, error } = await dealForCallback(request);
  if (error) return error;
  return callTurn(deal, await request.formData());
}
