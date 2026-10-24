import { spokenCode } from "@/lib/otp";
import { store } from "@/lib/store";
import { hangup, speak, verifyDealSignature, xml } from "@/lib/vobiz";

/** Vobiz answer_url for login-code calls: read the code twice, then hang up. */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("d");
  if (!verifyDealSignature(id, url.searchParams.get("k"))) return new Response("forbidden", { status: 403 });
  const code = await store.kvGet<string>(`otpcall:${id}`);
  if (!code) return xml(speak("Sorry, this GhostCart code has expired. Please ask for a new one.") + hangup());
  await store.kvDel(`otpcall:${id}`);
  const digits = spokenCode(code);
  return xml(speak(`Your GhostCart login code is: ${digits}. Again, your code is: ${digits}. Goodbye.`) + hangup());
}
