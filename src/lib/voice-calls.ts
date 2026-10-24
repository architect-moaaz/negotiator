import { counterFromApprover, decideApproval, inr } from "./negotiate";
import { store } from "./store";
import type { Deal } from "./types";
import { interpretApprover, openingLine } from "./voice-agent";
import { gather, hangup, speak, spokenInr, verifyDealSignature, xml } from "./vobiz";

const MAX_TURNS = 4;

/** Load the deal a Vobiz callback is about, rejecting forged or stale callbacks. */
export async function dealForCallback(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("d");
  if (!verifyDealSignature(id, url.searchParams.get("k"))) return { error: new Response("forbidden", { status: 403 }) };
  const deal = await store.getDeal(id!);
  return { deal };
}

const handled = () => xml(speak("Thanks. This offer has already been handled on GhostCart. Goodbye.") + hangup());

const approverName = (deal: Deal) => {
  const n = deal.negotiation!;
  return n.call?.role === "seller" ? `${n.terms.sellerName} (voice)` : "Deal desk (voice)";
};

export async function answerCall(deal: Deal | undefined) {
  const n = deal?.negotiation;
  if (!deal || !n?.call || deal.status !== "awaiting_approval") return handled();
  const line = openingLine(deal);
  n.call.status = "in_progress";
  n.call.transcript.push({ from: "agent", text: line, at: Date.now() });
  await store.saveDeal(deal);
  return xml(gather(line, deal.id) + speak("I didn't hear anything, so I'll leave this offer on your GhostCart dashboard. Goodbye.") + hangup());
}

export async function callTurn(deal: Deal | undefined, form: FormData) {
  const n = deal?.negotiation;
  if (!deal || !n?.call || !n.approval || deal.status !== "awaiting_approval") return handled();
  const call = n.call;
  const digits = String(form.get("Digits") ?? "").trim();
  const speech = String(form.get("Speech") ?? "").trim();
  const shopperOffer = n.approval.price;
  const role = call.role;

  call.turns += 1;
  if (speech || digits) call.transcript.push({ from: "approver", text: speech || `pressed ${digits}`, at: Date.now() });

  const intent = await interpretApprover({ digits, speech }, { shopperOffer, listPrice: deal.product.price, pendingCounter: call.pendingCounter });
  await store.log({
    type: "approval_call_turn",
    actor: role === "seller" ? "seller" : "human",
    userId: deal.userId,
    dealId: deal.id,
    detail: `Heard "${speech || (digits ? `key ${digits}` : "nothing")}" → ${intent.intent}${intent.intent === "counter" ? ` ${inr(intent.price)}` : ""}`,
  });

  const reply = async (text: string, end: boolean) => {
    call.transcript.push({ from: "agent", text, at: Date.now() });
    if (end) call.status = "completed";
    return xml(end ? speak(text) + hangup() : gather(text, deal.id) + speak("I'll leave this on your dashboard. Goodbye.") + hangup());
  };

  const approve = async (price: number) => {
    if (price !== shopperOffer) n.approval!.price = price;
    const text = `Done. I've approved ${spokenInr(price)}. The shopper has three minutes to pay. Thank you!`;
    call.transcript.push({ from: "agent", text, at: Date.now() });
    call.status = "completed";
    await decideApproval(deal, "approved", approverName(deal), role);
    return xml(speak(text) + hangup());
  };

  switch (intent.intent) {
    case "approve":
      return approve(shopperOffer);
    case "reject": {
      const text = `Okay, I've declined ${spokenInr(shopperOffer)}. I'll give them a final offer of ${spokenInr(n.terms.autoLimit)}. Thanks!`;
      call.transcript.push({ from: "agent", text, at: Date.now() });
      call.status = "completed";
      await decideApproval(deal, "rejected", approverName(deal), role);
      return xml(speak(text) + hangup());
    }
    case "counter": {
      const price = intent.price;
      if (price <= shopperOffer) return approve(shopperOffer);
      if (price > deal.product.price) {
        await store.saveDeal(deal);
        return reply(`${spokenInr(price)} is above your listed price of ${spokenInr(deal.product.price)}. What price should I offer them?`, false);
      }
      call.pendingCounter = price;
      await store.saveDeal(deal);
      return reply(`Just to confirm: you want me to offer them ${spokenInr(price)}? Say yes, or press 1.`, false);
    }
    case "confirm": {
      if (!call.pendingCounter) return approve(shopperOffer);
      const price = call.pendingCounter;
      const text = `Done. I've offered them ${spokenInr(price)}. If they accept, they pay within three minutes. Thanks!`;
      call.transcript.push({ from: "agent", text, at: Date.now() });
      call.status = "completed";
      call.pendingCounter = undefined;
      await counterFromApprover(deal, price, approverName(deal), role);
      return xml(speak(text) + hangup());
    }
    default: {
      await store.saveDeal(deal);
      if (call.turns >= MAX_TURNS) return reply("I'll leave this offer on your GhostCart dashboard. Goodbye.", true);
      return reply(
        `Sorry, I didn't catch that. Should I accept the shopper's ${spokenInr(shopperOffer)}? Say yes, no, or name a price. Or press 1 to approve, 2 to reject.`,
        false,
      );
    }
  }
}

export async function endCall(deal: Deal | undefined, form: FormData) {
  const call = deal?.negotiation?.call;
  if (!deal || !call) return;
  const decided = deal.status !== "awaiting_approval";
  if (call.status !== "completed") call.status = decided ? "completed" : "failed";
  await store.saveDeal(deal);
  await store.log({
    type: "approval_call_ended",
    actor: "system",
    userId: deal.userId,
    dealId: deal.id,
    detail: `Call ended after ${call.turns} turn(s)${form.get("Duration") ? `, ${form.get("Duration")}s` : ""}${form.get("HangupCause") ? ` (${form.get("HangupCause")})` : ""}: ${
      decided ? "decision made" : "no decision, still on the dashboard"
    }`,
  });
}
