import { OtpError, verifyLoginCode, type LoginRole } from "@/lib/otp";
import { rateLimit, verifyLimits } from "@/lib/rate-limit";
import { startSession } from "@/lib/session";
import { store } from "@/lib/store";
import { normalizePhone, publicUser } from "@/lib/users";

/** Step 2 of phone login: check the code and start a session. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { phone?: string; code?: string; role?: LoginRole };
  const role: LoginRole = body.role === "seller" ? "seller" : "buyer";
  const phone = body.phone ? normalizePhone(body.phone) : null;
  if (!phone || !body.code) return Response.json({ error: "Enter your number and the code we read out." }, { status: 400 });
  const limited = await rateLimit(...verifyLimits(request));
  if (limited) return limited;

  try {
    await verifyLoginCode(role, phone, body.code);
  } catch (err) {
    if (err instanceof OtpError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  if (role === "seller") {
    const sellerId = await store.sellerIdForPhone(phone);
    const seller = sellerId ? await store.getSeller(sellerId) : undefined;
    if (!seller) return Response.json({ error: "Store not found." }, { status: 404 });
    await startSession("seller", seller.id);
    await store.log({ type: "login", actor: "seller", detail: `${seller.storeName} logged in with a phone code` });
    return Response.json({ ok: true, storeName: seller.storeName });
  }

  const userId = await store.userIdForPhone(phone);
  const user = userId ? await store.getUser(userId) : undefined;
  if (!user) return Response.json({ error: "Account not found." }, { status: 404 });
  user.lastLoginAt = Date.now();
  await store.updateUser(user);
  await startSession("buyer", user.id);
  await store.log({ type: "login", actor: "user", userId: user.id, detail: `${user.name} logged in with a phone code` });
  return Response.json(publicUser(user));
}
