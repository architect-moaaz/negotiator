import { logSellerAction, requireStoreAccess } from "@/lib/shop/access";
import { connectWhatsApp } from "@/lib/meta/whatsapp";

/** Finish WhatsApp Embedded Signup. Body: { storeId, code, phoneNumberId, wabaId } from the signup popup. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { storeId?: string; code?: string; phoneNumberId?: string; wabaId?: string };
  const { store, phone, denied } = await requireStoreAccess(request, body.storeId ?? "", "manage");
  if (denied) return denied;
  if (!body.code || !body.phoneNumberId || !body.wabaId) return Response.json({ error: "WhatsApp signup didn't finish. Try again." }, { status: 400 });
  try {
    const { displayPhone } = await connectWhatsApp({ storeId: store.id, code: body.code, phoneNumberId: body.phoneNumberId, wabaId: body.wabaId });
    await logSellerAction(store, phone, `connected WhatsApp number ${displayPhone}`);
    return Response.json({ displayPhone });
  } catch (err) {
    console.error("WhatsApp connect failed", err);
    return Response.json({ error: "Meta didn't accept the connection. Try again, or check the number isn't on another WhatsApp app." }, { status: 502 });
  }
}
