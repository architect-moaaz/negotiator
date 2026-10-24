import QRCode from "qrcode";
import Image from "next/image";
import Link from "next/link";
import { AccountLink } from "@/components/account-link";
import { Negotiator } from "@/components/negotiator";
import { SocialProof } from "@/components/social-proof";
import { Ticker } from "@/components/ticker";

async function whatsappQr() {
  "use cache";
  const number = process.env.NEXT_PUBLIC_TWILIO_WHATSAPP_NUMBER;
  if (!number) return null;
  const text = process.env.NEXT_PUBLIC_TWILIO_SANDBOX_JOIN || "Hi GhostCart";
  const href = `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
  return { href, qr: await QRCode.toDataURL(href, { margin: 1, color: { dark: "#15131f", light: "#f1eee4" } }) };
}

export default async function Home() {
  const wa = await whatsappQr();

  return (
    <>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-16 pt-8 sm:px-8">
        <header className="flex items-center justify-between">
          <span className="text-xl font-bold tracking-tight">GhostCart</span>
          <nav className="flex gap-5">
            <Link href="/sell" className="text-muted hover:text-fg">
              For sellers
            </Link>
            <Link href="/dashboard" className="text-muted hover:text-fg">
              Live deals
            </Link>
            <AccountLink />
          </nav>
        </header>

        <section className="mt-14 sm:mt-20">
          <p className="text-saffron">Never pay the listed price again</p>
          <h1 className="mt-4 max-w-3xl text-[clamp(2.4rem,6.5vw,5rem)] font-bold leading-[0.95] tracking-[-0.03em]">
            Paste anything you were going to buy today.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted sm:text-xl">
            Our AI checks 8 stores for the best price, then haggles with you live and pays the discount from its own commission. Agree on a
            price and it&apos;s yours for 180 seconds.
          </p>
          <div className="mt-6">
            <SocialProof />
          </div>
        </section>

        <section className="mt-10">
          <Negotiator />
        </section>

        <section aria-label="Why trust GhostCart" className="mt-16 grid grid-cols-1 gap-6 border-t border-line pt-8 sm:grid-cols-3">
          <div>
            <p className="font-semibold">Free price check, always</p>
            <p className="mt-1 text-muted">You see the best price across all 8 stores before you decide anything. Haggle only if you want to.</p>
          </div>
          <div>
            <p className="font-semibold">Real prices, checked live</p>
            <p className="mt-1 text-muted">Amazon, Flipkart, Croma, Reliance Digital, Myntra, Ajio, Tata CLiQ and Nykaa, read the moment you paste.</p>
          </div>
          <div>
            <p className="font-semibold">An agent, with a human on call</p>
            <p className="mt-1 text-muted">The deal-desk agent runs on Pine Labs AgenticOrg, and a person signs off on every big discount.</p>
          </div>
        </section>

        {wa && (
          <section className="mt-16 flex items-center gap-5 rounded-2xl border border-line p-5 sm:max-w-md">
            <a href={wa.href} className="shrink-0" aria-label="Open GhostCart on WhatsApp">
              <Image src={wa.qr} alt="" width={96} height={96} unoptimized className="rounded-md" />
            </a>
            <p className="text-muted">
              <span className="text-fg">On your phone?</span> Scan to send links or screenshots to the GhostCart bot on WhatsApp.
            </p>
          </section>
        )}
      </main>
      <Ticker />
    </>
  );
}
