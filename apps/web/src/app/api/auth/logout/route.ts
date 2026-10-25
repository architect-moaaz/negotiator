import { cookies } from "next/headers";
import { endSellerSession, SELLER_SESSION_COOKIE } from "@/lib/sellers";
import { SESSION_COOKIE } from "@/lib/users";

export async function POST(request: Request) {
  const { role } = (await request.json().catch(() => ({}))) as { role?: string };
  const jar = await cookies();
  if (role === "seller") {
    await endSellerSession(jar.get(SELLER_SESSION_COOKIE)?.value);
    jar.delete(SELLER_SESSION_COOKIE);
  } else {
    jar.delete(SESSION_COOKIE);
  }
  return Response.json({ ok: true });
}
