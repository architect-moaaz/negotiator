import { inviteCode, referralCount } from "@/lib/referrals";
import { currentUser } from "@/lib/users";

/** The signed-in shopper's invite link and how many people joined through it. */
export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  const [code, joined] = await Promise.all([inviteCode(user.id), referralCount(user.id)]);
  return Response.json({ url: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/?invite=${code}`, joined }, { headers: { "Cache-Control": "no-store" } });
}
