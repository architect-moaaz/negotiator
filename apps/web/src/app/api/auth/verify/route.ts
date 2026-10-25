import { OtpError, verifyLoginCode, type LoginRole } from "@/lib/otp";
import { linkDevice } from "@/lib/fraud/signals";
import { rateLimit, verifyLimits } from "@/lib/rate-limit";
import { startSession } from "@/lib/session";
import { staffRoster } from "@/lib/staff";
import { store } from "@/lib/store";
import { maskPhone, normalizePhone, publicUser } from "@/lib/users";

/** Step 2 of phone login: check the code and start a session. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { phone?: string; code?: string; role?: LoginRole };
  const role: LoginRole = body.role === "seller" || body.role === "staff" || body.role === "member" ? body.role : "buyer";
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

  if (role === "member") {
    await startSession("member", phone);
    await linkDevice(request, "member", phone);
    await store.log({ type: "login", actor: "seller", detail: `Seller ${maskPhone(phone)} signed in with a phone code` });
    return Response.json({ ok: true });
  }

  if (role === "staff") {
    const staff = staffRoster().get(phone);
    if (!staff) return Response.json({ error: "This number isn't on the GhostCart staff list." }, { status: 404 });
    await startSession("staff", phone);
    await store.log({ type: "staff_login", actor: "human", detail: `${staff.name} (${staff.role}) logged in to the admin console` });
    return Response.json({ ok: true, name: staff.name, role: staff.role });
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
  await linkDevice(request, "buyer", user.id);
  await store.log({ type: "login", actor: "user", userId: user.id, detail: `${user.name} logged in with a phone code` });
  return Response.json(publicUser(user));
}
