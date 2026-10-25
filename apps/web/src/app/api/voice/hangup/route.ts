import { dealForCallback, endCall } from "@/lib/voice-calls";

/** Vobiz hangup_url: the call ended. */
export async function POST(request: Request) {
  const { deal, error } = await dealForCallback(request);
  if (error) return error;
  await endCall(deal, await request.formData());
  return new Response(null, { status: 204 });
}
