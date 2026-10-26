import { deleteShopperAccount, exportShopperData, PrivacyError } from "@/lib/privacy/data";
import { endSession } from "@/lib/session";
import { currentUser } from "@/lib/users";

/** Download everything we hold about the signed-in shopper. */
export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Log in to download your data." }, { status: 401 });
  const data = await exportShopperData(user);
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="ghostcart-my-data.json"`, "Cache-Control": "no-store" },
  });
}

/** Delete the signed-in shopper's account. Body: { confirm: "delete" }. */
export async function DELETE(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Log in to delete your account." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { confirm?: string };
  if (body.confirm?.trim().toLowerCase() !== "delete") return Response.json({ error: "Type delete to confirm." }, { status: 400 });
  try {
    await deleteShopperAccount(user);
  } catch (err) {
    if (err instanceof PrivacyError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
  await endSession("buyer");
  return Response.json({ deleted: true });
}
