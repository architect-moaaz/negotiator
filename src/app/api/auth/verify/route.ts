import { cookies } from "next/headers";
import { OtpError, verifyLoginCode, type LoginRole } from "@/lib/otp";
import { createSellerSession, SELLER_SESSION_COOKIE } from "@/lib/sellers";
import { store } from "@/lib/store";
import { normalizePhone, publicUser, SESSION_COOKIE } from "@/lib/users";

const cookieOpts = (maxAge: number) => ({ httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", maxAge, path: "/" });

/** Step 2 of phone login: check the code and start a session. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { phone?: string; code?: string; role?: LoginRole };
  const role: LoginRole = body.role === "seller" ? "seller" : "buyer";
  const phone = body.phone ? normalizePhone(body.phone) : null;
  if (!phone || !body.code) return Response.json({ error: "Enter your number and the code we read out." }, { status: 400 });

  try {
    await verifyLoginCode(role, phone, body.code);
  } catch (err) {
    if (err instanceof OtpError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const jar = await cookies();
  if (role === "seller") {
    const sellerId = await store.sellerIdForPhone(phone);
    const seller = sellerId ? await store.getSeller(sellerId) : undefined;
    if (!seller) return Response.json({ error: "Store not found." }, { status: 404 });
    const { sid, maxAge } = await createSellerSession(seller.id);
    jar.set(SELLER_SESSION_COOKIE, sid, cookieOpts(maxAge));
    await store.log({ type: "login", actor: "seller", detail: `${seller.storeName} logged in with a phone code` });
    return Response.json({ ok: true, storeName: seller.storeName });
  }

  const userId = await store.userIdForPhone(phone);
  const user = userId ? await store.getUser(userId) : undefined;
  if (!user) return Response.json({ error: "Account not found." }, { status: 404 });
  user.lastLoginAt = Date.now();
  await store.updateUser(user);
  jar.set(SESSION_COOKIE, user.id, cookieOpts(60 * 60 * 24 * 30));
  await store.log({ type: "login", actor: "user", userId: user.id, detail: `${user.name} logged in with a phone code` });
  return Response.json(publicUser(user));
}
