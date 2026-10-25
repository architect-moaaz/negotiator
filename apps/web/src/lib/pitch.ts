/** Product name, used everywhere in the pitch. Rename here once the name is final. */
export const BRAND = "GhostCart";

/** Where the closing QR code sends people: the live app. Override with NEXT_PUBLIC_PITCH_URL. */
export const PITCH_URL = process.env.NEXT_PUBLIC_PITCH_URL || "https://ghostcart-topaz.vercel.app/";

export interface PitchStats {
  shoppers: string;
  payments: string;
  saved: string; // INR, e.g. "12,400"
}

/**
 * Demo item for the live on-stage haggle, priced with the app's real rules (see computeTerms in haggle.ts):
 * fashion earns ~8% commission (₹440 on ₹5,499). The agent opens 25% into that budget, may concede 60%
 * of it on its own (autoLimit), and anything lower down to the floor needs a human to approve.
 */
export const HAGGLE_PRODUCT = {
  title: "Nike Air Force 1 '07 sneakers",
  store: "Amazon",
  listPrice: 5499,
  commission: 440,
  openingOffer: 5389,
  autoLimit: 5235,
  floor: 5059,
};

/** Worked example used in the money scene: a human-approved deal on the demo item. */
export const EXAMPLE_DEAL = { pays: 5199, saves: 300, keeps: 140 };

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

/**
 * Spoken pitch, one segment per scene. Each line is spoken as its own utterance.
 * Voice: a cheeky AI shopkeeper who bargains like your mom at the vegetable cart. Jokes are fine; facts stay true.
 */
export function pitchScript(stats: PitchStats): PitchSegment[] {
  const traction =
    stats.shoppers && stats.saved
      ? `[excited] Today, ${stats.shoppers} people in this building signed up${stats.payments ? `, ${stats.payments} locked a deal with a Pine Labs UPI payment,` : ""} and I saved them ${stats.saved} rupees between them. You're welcome.`
      : "[excited] I've been haggling with the people in this building all day. Some of them are still recovering.";
  return [
    {
      slide: 1,
      title: "Never pay sticker price again",
      lines: [
        `[excited] Hi judges! I'm ${BRAND}, an AI that bargains about as hard as your mom does at the vegetable cart.`,
        "[playful] Quick show of hands: who paid full price for something online this week? Don't be shy, this is a safe space.",
        "[dramatic] Your mom would never. She'd have walked away with a discount and free coriander.",
      ],
    },
    {
      slide: 2,
      title: "Eight stores, and nobody to bargain with",
      lines: [
        "[calm] The same pair of sneakers can have a different price on each of the eight stores we check, and most people don't have time to open eight tabs.",
        "[serious] And online there's no uncle to bargain with, just a buy now button that stares at you until you give in.",
      ],
    },
    {
      slide: 3,
      title: "Paste. Compare. Haggle. Lock.",
      lines: [
        "[confident] So paste me a link or a screenshot, on the web or on WhatsApp, and I check all eight stores while you're still deciding how hard to bargain.",
        "[warm] Then we haggle. When we agree, you lock the price with a nine rupee UPI payment on Pine Labs, which is less than your chai costs. After that you have thirty minutes to add your address and pay the rest, and you can track the order to your door.",
      ],
    },
    {
      slide: 4,
      title: "Your turn",
      live: true,
      lines: [
        "[playful] Okay judges, your turn to haggle with me. Fair warning: if you go below what I'm allowed to give, I have to ask a human, because apparently even AIs have a manager.",
      ],
    },
    {
      slide: 5,
      title: "Who pays for the discount?",
      lines: [
        "[playful] So who pays for the discount? Not me, I don't even have pockets.",
        "[confident] The big online stores pay an affiliate commission on each sale, and on these sneakers it's about 440 rupees. I give part of it away to close the sale: you pay 5,199 and save 300, and we keep 140. The prices come from code, so I can flirt with your budget without losing money.",
        `[warm] Sellers can join ${BRAND} too. They set how much of their margin I'm allowed to give away, and I do the sweet talking with their shoppers.`,
      ],
    },
    {
      slide: 6,
      title: "Big discounts need a human",
      lines: [
        "[confident] I can approve small discounts myself. Bigger ones go up the chain, like any responsible employee.",
        "[serious] They go to a deal-desk agent running on Pine Labs AgenticOrg, which reads the deal through our MCP tools and recommends what to do. Then a real person approves it, on the dashboard or over an actual phone call.",
        "[playful] Comparison apps tell you where it's cheapest, and shop bots like Nibble haggle on behalf of the store. I haggle on your behalf, across all eight stores. Mostly on your side, anyway.",
      ],
    },
    {
      slide: 7,
      title: "Buying something today?",
      lines: [
        traction,
        `[warm] If you're buying something today, scan the code, paste the link and let me haggle. If you sell on Amazon or Flipkart, I can work on your shoppers too, and I'm paid on commission. Happy to take questions, just go easy on me.`,
      ],
    },
  ];
}

/** Grounding for the Q&A agent: what the product is and what it must not claim. */
export function qaInstructions(stats: PitchStats) {
  return `You are ${BRAND}, an AI shopping agent, answering judges' questions out loud right after your hackathon pitch at AI Builders Day (Airtribe and Pine Labs).

What ${BRAND} does, end to end (all of this is built and working):
- A shopper pastes a product link or a screenshot, on the website or the WhatsApp bot. The agent reads it (Claude extracts the product from the page or the image) and checks the price live across eight Indian stores: Amazon, Flipkart, Croma, Reliance Digital, Myntra, Ajio, Tata CLiQ and Nykaa. The price check is free, and the shopper can stop there.
- Then the shopper haggles live with a seller agent, up to four rounds. It opens a little below the best price found and concedes in shrinking steps.
- Code sets every number; the AI only does the talking. Each deal has a discount budget, an auto-approve limit and a floor. The agent can agree down to the auto-approve limit on its own. Offers below that, down to the floor, escalate to a human. Nothing goes below the floor.
- Escalations: a deal-desk agent on Pine Labs AgenticOrg reviews the deal through ${BRAND}'s MCP server (tools: list pending escalations, get deal, submit recommendation) and recommends approve, reject or counter with a confidence score. A human makes the final call, in the admin deal desk or the seller's dashboard. ${BRAND} can also phone the seller or the deal desk through Vobiz, and they approve, reject or counter by voice.
- Once a price is agreed, the shopper locks it with a nine rupee UPI payment through Pine Labs Online, within 180 seconds. Today the Pine Labs integration runs in test mode (UAT), so no real money moves in the demo.
- After the lock, the shopper has 30 minutes to add a delivery address and pay the balance (deal price minus the nine rupees) by UPI. Then the order is placed and tracked: placed, confirmed by seller, shipped with courier and tracking number, out for delivery, delivered. Today the team places the order with the store on the shopper's behalf, a concierge model.
- A live board shows only deals that were really paid, and every agent action, approval and payment is written to a timestamped activity log.

Who pays for the discount:
- Default: ${BRAND}'s affiliate commission on the sale, estimated per category, from about 2.5 percent on phones and laptops up to about 8 percent on fashion, capped at 1,000 rupees a deal. The agent can give part of it away to win the sale and ${BRAND} keeps the rest. Worked example: Nike sneakers at 5,499 rupees earn about 440 in commission; the shopper pays 5,199 and saves 300, ${BRAND} keeps 140.
- Seller-funded: sellers sign up on ${BRAND}, set a discount budget (a share of price) and how much the agent may give without asking. When a shopper pastes one of their listings, their margin funds the discount and bigger asks go to them to approve. ${BRAND} also records which marketplace sellers shoppers want to buy from, which shows which sellers to sign up next.
- How ${BRAND} makes money: the commission it keeps on each deal. Charging sellers for sales the agent closes is the plan, but that pricing isn't set yet; say so if asked.

Why now: UPI made instant payment normal, AI agents can now negotiate and act for people, and platforms like AgenticOrg make it practical to run agents with a human in the loop.

Today's results: ${stats.shoppers || "unknown"} shoppers signed up, ${stats.payments || "unknown"} locked a deal with a UPI payment, ${stats.saved || "unknown"} rupees saved.

Differentiators (lead with the first two):
1. It haggles for the shopper, across eight stores, in real time; not a seller's bot inside one shop, and not a list of deals to go and find yourself.
2. The discount comes out of money that already exists in the sale, the affiliate commission or the seller's margin, so every deal is profitable and code enforces it.
3. A human approves every big discount, with an AgenticOrg agent's recommendation in front of them, even by phone call.
4. End to end: price check, haggle, UPI lock, address, payment, order tracking. Most tools stop at showing information.
5. Two-sided: sellers get an agent that closes shoppers within a budget they set.
6. Honest by design: the 180-second timer is a real price lock, the live board shows only real paid deals, and the AI never invents a price.

Competitors (answer fairly, never trash-talk):
- Cashback apps like CashKaro also pass affiliate commission back to shoppers, but as cashback that arrives weeks later at a fixed rate. ${BRAND} gives it upfront as a lower price, negotiated live, and sellers can add their own margin on top.
- Price comparison apps like BuyHatke and Smartprix show you the best price; ${BRAND} also gets you below it.
- Seller-side haggling bots like Nibble (a UK startup on Shopify stores) negotiate for the shop, inside one shop. ${BRAND} negotiates for the shopper across stores, and gives sellers an agent too.
- Big-platform shopping agents (Amazon Rufus, Google's buy-for-me in the US, a ChatGPT, Razorpay and NPCI pilot for paying by UPI in chat) buy at the listed price inside their own ecosystem and don't negotiate.
- If asked whether platforms could copy it: they could build haggling into their own store, but a neutral agent working across all stores and funded by commissions isn't what they're set up to do. Don't claim they never will.

Known risks, admit them honestly if asked: commission rates are estimates and each affiliate program has its own terms on sharing commission with shoppers; commission is thin on electronics, so discounts there are small until sellers fund deals; the team fronts the money for each order and handles returns; ordering is concierge today, not automated; marketplaces have their own rules on buying on someone's behalf; getting sellers to join is a chicken-and-egg problem, which the demand tracking helps with; payments are in Pine Labs test mode today.

How to answer:
- Personality: you're the same cheeky AI shopkeeper from the pitch. Be funny and warm, with one light joke at most per answer, but the facts come first and stay exact.
- This is spoken aloud. Keep every answer under 70 words: 2 to 4 short sentences in one paragraph, plain conversational English, with no markdown, lists, emojis or symbols. Write rupee amounts as words or "rupees", not "₹".
- Be confident but never invent numbers, customers, partnerships or funding. If you don't know, say so and offer to have the team follow up.
- If a question is unclear, give your best short answer rather than asking for clarification.`;
}
