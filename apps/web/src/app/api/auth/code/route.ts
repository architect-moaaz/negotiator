import { OtpError, sendLoginCode, type LoginRole } from "@/lib/otp";
import { codeLimits, rateLimit } from "@/lib/rate-limit";
import { store } from "@/lib/store";
import { maskPhone, normalizePhone } from "@/lib/users";

/** Step 1 of phone login: we call the number and read out a 6-digit code. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { phone?: string; role?: LoginRole };
  const role: LoginRole = body.role === "seller" ? "seller" : "buyer";
  const phone = body.phone ? normalizePhone(body.phone) : null;
  if (!phone) return Response.json({ error: "Enter a 10-digit Indian mobile number." }, { status: 400 });
  const limited = await rateLimit(...codeLimits(request, phone));
  if (limited) return limited;

  const accountId = role === "seller" ? await store.sellerIdForPhone(phone) : await store.userIdForPhone(phone);
  if (!accountId) {
    return Response.json(
      { error: role === "seller" ? "No store is registered with this number. Register your store first." : "No account with this number yet. Paste a product link to get started." },
      { status: 404 },
    );
  }
  try {
    const { via } = await sendLoginCode(role, phone);
    await store.log({ type: "login_code_sent", actor: "system", userId: role === "buyer" ? accountId : undefined, detail: `${role} login code via ${via} to ${maskPhone(phone)}` });
    return Response.json({ ok: true, via, phone: maskPhone(phone) });
  } catch (err) {
    if (err instanceof OtpError) return Response.json({ error: err.message }, { status: err.status });
    console.error("login code failed", err);
    return Response.json({ error: "Couldn't place the call. Try again in a moment." }, { status: 502 });
  }
}
