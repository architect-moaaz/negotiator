import { stopPriceAlert } from "@/lib/alerts";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/** "Stop this alert" from the link in a message, no sign-in. Body: { token }. */
export async function POST(request: Request) {
  const limited = await rateLimit({ name: "alerts-stop:ip", id: clientIp(request), max: 30, windowSeconds: 60 * 60 });
  if (limited) return limited;
  const { token } = (await request.json().catch(() => ({}))) as { token?: string };
  if (typeof token !== "string" || !/^[\w-]{20,40}$/.test(token)) return Response.json({ error: "This link isn't valid." }, { status: 400 });
  await stopPriceAlert({ token });
  return Response.json({ stopped: true }); // same answer whether or not it was live, so links can't be probed
}
