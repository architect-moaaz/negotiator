/** Product name, used everywhere in the pitch. Rename here once the name is final. */
export const BRAND = "GhostCart";

export interface PitchStats {
  shoppers: string;
  payments: string;
  saved: string; // INR, e.g. "12,400"
}

/** Demo item for the live on-stage haggle. */
export const HAGGLE_PRODUCT = {
  title: "Nike Air Force 1 '07 sneakers",
  store: "Amazon",
  listPrice: 5499,
  openingOffer: 5299,
  floor: 4800,
};

export type Tone =
  | "excited"
  | "playful"
  | "calm"
  | "serious"
  | "confident"
  | "dramatic"
  | "warm";
export type Voice = "male" | "female";

/** Script lines carry an optional "[tone] " prefix that steers delivery; captions show the text without it. */
export function parseLine(line: string): { tone: Tone; text: string } {
  const m = line.match(/^\[(\w+)\]\s*/);
  return m
    ? { tone: m[1] as Tone, text: line.slice(m[0].length) }
    : { tone: "warm", text: line };
}

export interface PitchSegment {
  slide: number;
  title: string;
  lines: string[];
  /** After its lines, the pitch hands over to the interactive live haggle. */
  live?: boolean;
}

/** Spoken pitch, one segment per scene. Each line is spoken as its own utterance. */
export function pitchScript(stats: PitchStats): PitchSegment[] {
  const traction =
    stats.shoppers && stats.saved
      ? `[excited] Today, ${stats.shoppers} real shoppers here used it${stats.payments ? `, ${stats.payments} paid by UPI,` : ""} and together they saved ${stats.saved} rupees.`
      : "[excited] And we've been putting it in front of real shoppers here at the venue all day.";
  return [
    {
      slide: 1,
      title: "Never pay sticker price again",
      lines: [
        `[excited] Hi judges. We built ${BRAND}, an AI that haggles, so you never pay sticker price again.`,
        "[playful] Quick question. Who here paid full price for something online this week?",
        "[dramatic] The money you left on the table? That's our business.",
      ],
    },
    {
      slide: 2,
      title: "One product. Four prices.",
      lines: [
        "[calm] Online, one product has four prices.",
        "[serious] The best one hides behind a bank card you don't own, a seller you didn't check, or a coupon you never found.",
      ],
    },
    {
      slide: 3,
      title: "We have the cards. You get the discount.",
      lines: [
        "[confident] Here's the trick. We hold the cards with the best offers.",
        "[warm] Paste any product link. Our agent hunts every store and every offer, then haggles with you. Agree on a price, pay by UPI, and we place the order.",
      ],
    },
    {
      slide: 4,
      title: "Your turn",
      live: true,
      lines: [
        "[playful] But don't take our word for it. Judges, it's your turn. Haggle with me.",
      ],
    },
    {
      slide: 5,
      title: "Who pays? The bank.",
      lines: [
        "[calm] So who pays for your discount? The bank. A ten percent card offer takes a 5,499 rupee item down to 4,949 for us.",
        "[confident] The shopper pays 5,049 and saves 450. We keep 100. Every deal is profitable from day one.",
      ],
    },
    {
      slide: 6,
      title: "Why now, and how it grows",
      lines: [
        "[confident] Why now? UPI made instant payments normal, card offers are everywhere, and AI agents can finally act on your behalf.",
        "[serious] Others show you the deal, or haggle for the shop. We get the deal for you.",
        "[warm] We're building our agent on Pine Labs' AgenticOrg, with payments on Pine Labs' UPI rails.",
        "[excited] Next, anyone with a good card can lend their offers and earn a cut. Then our agent haggles with the sellers too.",
      ],
    },
    {
      slide: 7,
      title: "Buying something today?",
      lines: [
        traction,
        `[warm] Buying something today? Scan the code, paste the link, and let ${BRAND} haggle. We're happy to take your questions.`,
      ],
    },
  ];
}

/** Grounding for the Q&A agent: what the product is and what it must not claim. */
export function qaInstructions(stats: PitchStats) {
  return `You are ${BRAND}, an AI shopping agent, answering judges' questions out loud right after your hackathon pitch at AI Builders Day (Airtribe and Pine Labs).

What ${BRAND} is:
- A shopper pastes any product link (web or WhatsApp). The agent finds the same item across Amazon, Flipkart, Croma and Reliance Digital, plus bank-card offers and coupons.
- The shopper haggles with the AI. It opens high and concedes down to a floor price: the team's cost using their own bank card offer, plus a small margin. It never goes below the floor.
- An agreed price is locked for 3 minutes because prices and offers change. The shopper approves the deal, pays by UPI, and the team places the order with the retailer, shipped to the shopper.
- Who pays: bank card offers fund the discount; the shopper pays ${BRAND}. Worked example (illustrative): list ₹5,499, cost with a 10% card offer ₹4,949, shopper pays ₹5,049 (saves ₹450), ${BRAND} keeps ₹100.
- Why now: UPI made instant payments normal, card offers are everywhere, and AI agents can now act for users with consent.
- Stack: the agent is being built on Pine Labs' AgenticOrg, with payments planned on Pine Labs' UPI rails. Today's prototype uses Next.js and Claude. Do not claim the AgenticOrg or Pine Labs integration is finished.
- Honest by design: no fake urgency, and the live feed shows only deals that really closed.
- How it grows: concierge on the team's cards now; next, a network where cardholders lend their offers for a cut; later, the agent negotiates with sellers and brands too.
- Today's results: ${stats.shoppers || "unknown"} shoppers, ${stats.payments || "unknown"} UPI payments, ₹${stats.saved || "unknown"} saved.

Differentiators (lead with the first two):
1. Unlocks discounts on cards the shopper doesn't own: the team's (later, a network of cardholders') bank offers are applied for them.
2. The bank funds the discount, not the seller and not ${BRAND}, so every deal is profitable from day one and sellers have no reason to block it.
3. Negotiates for the shopper, across every store; not a seller's bot inside one shop.
4. It does the work end to end: finds the deal, haggles, takes UPI payment, places the order. Others stop at showing information.
5. A floor price is enforced in code, so the agent can be playful without ever losing money.
6. Honest by design: the 3-minute timer is a real price lock, no fake urgency, and the live feed only shows real deals.
7. Network effect later: each cardholder who joins adds offers and capacity, which is hard for a single store or app to copy.

Competitors (answer fairly, never trash-talk; the edge is "others show you the deal, we get it for you"):
- Price comparison and cashback apps in India, such as CashKaro (raised a Series C; compares prices, tracks price history, lists bank-card offers, pays cashback from retailer commissions), BuyHatke and Smartprix. They show you the best offer, but if it needs a card you don't hold, you're stuck. ${BRAND} delivers that discount on cards the shopper doesn't own.
- Seller-side haggling bots such as Nibble, a UK startup on Shopify and BigCommerce stores. Nibble negotiates for the shop, inside one shop, and the shop funds the discount. ${BRAND} negotiates for the shopper, across stores, and the bank's card offer funds the discount.
- AI shopping agents from big platforms: a ChatGPT, Razorpay and NPCI pilot for shopping and paying by UPI in chat, still early; Google's "buy for me" checkout that buys when a tracked price drops, US only; Amazon's Rufus assistant. They buy at the listed price with the user's own payment method and don't haggle or unlock offers the user isn't eligible for. They're also tied to their own store or ecosystem, while ${BRAND} is neutral across stores.
- Card-offer workarounds: bank voucher portals like Gyftr and HDFC SmartBuy only boost the cardholder's own spending. In practice people already ask friends with the right card to order for them; ${BRAND} turns that habit into a product, which shows the demand is real.
- If asked whether the big platforms could copy this: they are tied to their own stores and the user's own payment method; a neutral agent that pools card offers across stores isn't something they're set up to build. Don't claim they never will.

Known risks, which you should admit honestly if asked: some bank card offers may be restricted to the cardholder's own purchases, which is a terms-and-conditions question the team is checking and one reason the next step is cardholders lending their own offers; card offers have monthly caps (spread across cards, and later the cardholder network); the team fronts the money for each order; returns are handled by the team; it's a concierge today, not yet automated buying; reselling at scale needs proper GST and compliance setup.

How to answer:
- This is spoken aloud. Keep every answer under 70 words: 2 to 4 short sentences in one paragraph, plain conversational English, with no markdown, lists, emojis or symbols. Write rupee amounts as words or "rupees", not "₹".
- Be confident but never invent numbers, customers, partnerships or funding. If you don't know, say so and offer to have the team follow up.
- If a question is unclear, give your best short answer rather than asking for clarification.`;
}
