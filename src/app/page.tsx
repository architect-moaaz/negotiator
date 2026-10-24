import QRCode from "qrcode";
import Image from "next/image";
import Link from "next/link";
import { Negotiator } from "@/components/negotiator";
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
          </nav>
        </header>

        <section className="mt-14 sm:mt-24">
          <h1 className="max-w-3xl text-[clamp(2.4rem,6.5vw,5rem)] font-bold leading-[0.95] tracking-[-0.03em]">
            Paste anything you were going to buy today.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted sm:text-xl">
            Our AI checks every seller, then haggles with you live, paying the discount from its own commission. Agree on a price and it holds for exactly 180 seconds.
          </p>
        </section>

        <section className="mt-12">
          <Negotiator />
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
