import { OtpError, sendLoginCode, verifyLoginCode } from "@/lib/otp";
import { codeLimits, rateLimit, verifyLimits } from "@/lib/rate-limit";
import { createSeller } from "@/lib/sellers";
import { startSession } from "@/lib/session";
import { store } from "@/lib/store";
import { maskPhone, normalizePhone } from "@/lib/users";

/**
 * Merchant signup: opt in to negotiate GhostCart deals from your own margin. Two steps, like shopper
 * signup: the form fields first (we call the number with a code), then the same fields plus the code.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    storeName?: string;
    aliases?: string;
    contactName?: string;
    phone?: string;
    budgetPct?: number;
    autoApprovePct?: number;
    code?: string;
  };
  const storeName = body.storeName?.trim().slice(0, 80);
  const contactName = body.contactName?.trim().slice(0, 80);
  const phone = body.phone ? normalizePhone(body.phone) : null;
  const budgetPct = Number(body.budgetPct);
  const autoApprovePct = Number(body.autoApprovePct);

  if (!storeName) return Response.json({ error: "Enter your store name." }, { status: 400 });
  if (!contactName) return Response.json({ error: "Enter a contact name." }, { status: 400 });
  if (!phone) return Response.json({ error: "Enter a 10-digit Indian mobile number." }, { status: 400 });
  if (!(budgetPct >= 1 && budgetPct <= 30)) return Response.json({ error: "Max discount must be between 1% and 30%." }, { status: 400 });
  if (!(autoApprovePct >= 10 && autoApprovePct <= 100)) return Response.json({ error: "Auto-approve must be between 10% and 100%." }, { status: 400 });

  if (await store.sellerIdForPhone(phone)) return Response.json({ error: "A store is already registered with this number. Log in instead." }, { status: 409 });

  try {
    if (!body.code) {
      const limited = await rateLimit(...codeLimits(request, phone));
      if (limited) return limited;
      const { via } = await sendLoginCode("seller-signup", phone);
      return Response.json({ codeSent: true, via, phone: maskPhone(phone) });
    }
    const limited = await rateLimit(...verifyLimits(request));
    if (limited) return limited;
    await verifyLoginCode("seller-signup", phone, body.code);
  } catch (err) {
    if (err instanceof OtpError) return Response.json({ error: err.message }, { status: err.status });
    console.error("seller signup code failed", err);
    return Response.json({ error: "Couldn't place the call. Try again in a moment." }, { status: 502 });
  }

  const aliases = (body.aliases ?? "")
    .split(/[,\n]/)
    .map((a) => a.trim())
    .filter(Boolean)
    .slice(0, 10);
  const { seller, token } = await createSeller({
    storeName,
    aliases,
    contactName,
    phone,
    budgetPct: budgetPct / 100,
    autoApproveShare: autoApprovePct / 100,
  });
  await startSession("seller", seller.id);
  return Response.json({ id: seller.id, storeName: seller.storeName, matches: seller.aliases, token });
}
