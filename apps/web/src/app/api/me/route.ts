import { endSession } from "@/lib/session";
import { currentUser, publicUser } from "@/lib/users";

export async function GET() {
  const user = await currentUser();
  return Response.json(user ? publicUser(user) : null, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE() {
  await endSession("buyer");
  return Response.json(null);
}
