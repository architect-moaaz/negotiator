import { cookies } from "next/headers";
import { currentUser, publicUser, SESSION_COOKIE } from "@/lib/users";

export async function GET() {
  const user = await currentUser();
  return Response.json(user ? publicUser(user) : null, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE() {
  (await cookies()).delete(SESSION_COOKIE);
  return Response.json(null);
}
