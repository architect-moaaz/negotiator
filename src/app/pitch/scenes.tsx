"use client";

import QRCode from "qrcode";
import { useEffect, useState, type ReactNode } from "react";
import { BRAND, type PitchStats } from "@/lib/pitch";
import { Tilt } from "./stage";

/** Animated visuals for the voice pitch: one scene per script segment, revealed line by line as the agent speaks. */

type SceneProps = { line: number; stats: PitchStats };

const LIME = "#C6F432";
const ACCENT =
  "animate-shimmer bg-[linear-gradient(90deg,#C6F432,#00D1B2,#C6F432)] bg-[length:200%_auto] bg-clip-text text-transparent";

/** Fades/slides children in once `on` (the narration has reached their line). */
function Reveal({
  on,
  children,
  className = "",
  from = "translate-y-8",
  delay = 0,
}: {
  on: boolean;
  children: ReactNode;
  className?: string;
  from?: string;
  delay?: number;
}) {
  return (
    <div
      className={`transition-all duration-700 ease-out ${on ? "translate-x-0 translate-y-0 scale-100 opacity-100" : `${from} opacity-0`} ${className}`}
      style={{ transitionDelay: on ? `${delay}ms` : "0ms" }}
    >
      {children}
    </div>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-sm font-semibold uppercase tracking-[0.35em] text-[#C6F432] sm:text-base">
      {children}
    </p>
  );
}

function Headline({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={`animate-rise font-display text-[clamp(2.4rem,5.6vw,6rem)] font-bold leading-[1.02] tracking-[-0.03em] [text-shadow:0_4px_30px_#0008] ${className}`}
    >
      {children}
    </h2>
  );
}

function CountUp({
  to,
  active,
  prefix = "",
  duration = 1400,
}: {
  to: number;
  active: boolean;
  prefix?: string;
  duration?: number;
}) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setValue(Math.round(to * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, to, duration]);
  return (
    <>
      {prefix}
      {value.toLocaleString("en-IN")}
    </>
  );
}

function Ghost({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 140" className={className} aria-hidden>
      <path
        d="M60 6C30 6 12 28 12 58v70l14-12 12 12 11-12 11 12 11-12 11 12 12-12 14 12V58C108 28 90 6 60 6Z"
        fill={LIME}
      />
      <circle cx="44" cy="58" r="9" fill="#0E1116" />
      <circle cx="78" cy="58" r="9" fill="#0E1116" />
      <path
        d="M44 86q16 12 32 0"
        stroke="#0E1116"
        strokeWidth="6"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* 1 ── Cold open, full screen: a giant price that gets slashed */
function Cover({ line }: SceneProps) {
  return (
    <div className="relative flex w-full max-w-6xl flex-col items-center gap-6 text-center">
      <Eyebrow>{BRAND}</Eyebrow>
      <Headline className="text-[clamp(2rem,4.4vw,4.5rem)]">
        Never pay <span className={ACCENT}>sticker price</span> again.
      </Headline>
      <Tilt className="mt-4 rounded-[2.5rem]" max={10}>
        <div className="relative rounded-[2.5rem] border border-white/10 bg-white/[0.05] px-14 py-10 backdrop-blur-xl">
          <p
            className={`font-display text-[clamp(5rem,14vw,13rem)] font-bold leading-none tabular-nums transition-all duration-700 ${
              line >= 2
                ? "text-[#8A9087] line-through decoration-[#FF8A3D] decoration-[10px]"
                : ""
            }`}
          >
            ₹5,499
          </p>
          <Reveal
            on={line >= 2}
            from="translate-y-6 scale-90"
            className="absolute -bottom-10 -right-8 rotate-[-6deg]"
          >
            <p className="rounded-3xl bg-[#C6F432] px-8 py-4 font-display text-[clamp(2.5rem,5vw,4.5rem)] font-bold text-[#07090D] shadow-[0_0_80px_#C6F43299]">
              ₹5,049
            </p>
          </Reveal>
        </div>
      </Tilt>
      <Reveal
        on={line === 1}
        from="scale-75"
        className="absolute -left-4 top-1/2"
      >
        <p className="-rotate-6 rounded-2xl bg-[#FF8A3D] px-5 py-3 text-lg font-bold text-[#07090D] shadow-xl">
          Paid full price this week? 🙋
        </p>
      </Reveal>
      <Ghost className="animate-float absolute -right-2 top-0 hidden w-24 md:block" />
    </div>
  );
}

/* 2 ── Problem: same item, four prices, locked offers */
const STORES = [
  { name: "Amazon", price: "₹5,499", tilt: "-rotate-3" },
  { name: "Flipkart", price: "₹5,349", tilt: "rotate-2" },
  { name: "Croma", price: "₹5,590", tilt: "-rotate-1" },
  { name: "Reliance Digital", price: "₹5,450", tilt: "rotate-3" },
];
const OFFERS = [
  "HDFC card −10%",
  "ICICI −₹500",
  "Coupon SAVE5",
  "SBI no-cost EMI",
];

function Problem({ line }: SceneProps) {
  return (
    <div className="flex w-full max-w-6xl flex-col gap-10">
      <div className="flex flex-col gap-4 text-left">
        <Eyebrow>The problem</Eyebrow>
        <Headline>
          One product. <span className={ACCENT}>Four prices.</span>
        </Headline>
      </div>
      <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
        {STORES.map((s, i) => (
          <div
            key={s.name}
            className="animate-pop-in"
            style={{ animationDelay: `${i * 180}ms` }}
          >
            <Tilt className="rounded-2xl" max={14}>
              <div
                className={`${s.tilt} rounded-2xl border border-white/10 bg-white/[0.05] p-5 text-left shadow-2xl backdrop-blur-xl`}
              >
                <div className="mb-4 flex gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#FF8A3D]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#2A313B]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#2A313B]" />
                </div>
                <p className="text-sm text-[#8A9087]">{s.name}</p>
                <p className="font-display text-3xl font-bold sm:text-4xl">
                  {s.price}
                </p>
              </div>
            </Tilt>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        {OFFERS.map((o, i) => (
          <Reveal
            key={o}
            on={line >= 1}
            from="scale-75 translate-y-4"
            delay={i * 120}
          >
            <p className="flex items-center gap-2 rounded-full border border-dashed border-[#8A9087] px-4 py-2 text-base text-[#B9BDB4]">
              <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
                <path
                  d="M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z"
                  stroke="currentColor"
                  strokeWidth="2"
                  fill="none"
                />
              </svg>
              {o}
            </p>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

/* 3 ── Insight: a fan of cards + the flow in four words */
const CARDS = [
  { bank: "HDFC", tint: "linear-gradient(135deg,#2B5CB0,#0F2347)" },
  { bank: "ICICI", tint: "linear-gradient(135deg,#C2522D,#4A190C)" },
  { bank: "SBI", tint: "linear-gradient(135deg,#2A8FBF,#0E3447)" },
  { bank: "Axis", tint: "linear-gradient(135deg,#B03374,#420E28)" },
];
const FLOW = ["Paste", "Hunt", "Haggle", "Pay"];

function Insight({ line }: SceneProps) {
  return (
    <div className="grid w-full max-w-6xl items-center gap-14 md:grid-cols-2">
      <div className="relative mx-auto h-72 w-80 sm:h-80 sm:w-96">
        {CARDS.map((c, i) => (
          <div
            key={c.bank}
            className="absolute left-1/2 top-1/2 h-44 w-72 origin-bottom rounded-2xl p-5 text-left shadow-[0_20px_50px_#00000090] ring-1 ring-white/20"
            style={{
              background: c.tint,
              transform: `translate(-50%, -50%) rotate(${(i - 1.5) * 14}deg) translateY(${-Math.abs(i - 1.5) * 6}px)`,
            }}
          >
            <p className="font-display text-xl font-bold text-[#F4F1EA]">
              {c.bank}
            </p>
            <div className="mt-6 h-8 w-11 rounded-md bg-[#E8C547]/80" />
            <p className="mt-4 font-mono text-sm tracking-widest text-[#F4F1EA]/70">
              •••• •••• •••• {4021 + i * 1111}
            </p>
          </div>
        ))}
        <Reveal
          on
          className="absolute -right-4 -top-4"
          from="scale-50"
          delay={600}
        >
          <p className="rounded-full bg-[#C6F432] px-5 py-3 font-display text-xl font-bold text-[#0E1116] shadow-[0_0_40px_#C6F43280]">
            −10% unlocked
          </p>
        </Reveal>
      </div>
      <div className="flex flex-col gap-8 text-left">
        <Eyebrow>The insight</Eyebrow>
        <Headline>
          We have the cards.
          <br />
          <span className={ACCENT}>You get the discount.</span>
        </Headline>
        <div className="flex flex-wrap items-center gap-2">
          {FLOW.map((step, i) => (
            <Reveal
              key={step}
              on={line >= 1}
              from="translate-y-4"
              delay={i * 250}
              className="flex items-center gap-2"
            >
              <p className="rounded-full bg-white/10 px-4 py-2 font-display text-xl font-semibold ring-1 ring-white/10">
                {step}
              </p>
              {i < FLOW.length - 1 && <span className="text-[#C6F432]">→</span>}
            </Reveal>
          ))}
        </div>
      </div>
    </div>
  );
}

/* 4 ── Handover to the live demo, full screen */
function YourTurn() {
  return (
    <div className="flex w-full flex-col items-center gap-8 text-center">
      <p className="flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.35em] text-[#FF3D7F]">
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#FF3D7F] opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-[#FF3D7F]" />
        </span>
        Live demo
      </p>
      <h2 className="animate-rise font-display text-[clamp(5rem,16vw,15rem)] font-bold leading-[0.9] tracking-[-0.05em]">
        Your <span className={ACCENT}>turn.</span>
      </h2>
      <p className="text-2xl text-[#B9BDB4]">
        Haggle with the agent. It won’t go below its floor.
      </p>
    </div>
  );
}

/* 5 ── Money, full-screen numbers */
function Money({ line }: SceneProps) {
  const bars = [
    { label: "Listed", value: 5499, color: "bg-[#4A5058]" },
    { label: "Our cost, 10% card offer", value: 4949, color: "bg-[#8A9087]" },
    { label: "Shopper pays", value: 5049, color: "bg-[#C6F432]" },
  ];
  return (
    <div className="flex w-full max-w-6xl flex-col gap-12">
      <div className="flex flex-col gap-4 text-left">
        <Eyebrow>The business</Eyebrow>
        <Headline>
          Who pays? <span className={ACCENT}>The bank.</span>
        </Headline>
      </div>
      {line < 1 ? (
        <div className="flex flex-col gap-5">
          {bars.map((b, i) => (
            <div
              key={b.label}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:grid-cols-[16rem_1fr_auto]"
            >
              <p className="col-span-2 text-left text-lg text-[#B9BDB4] sm:col-span-1">
                {b.label}
              </p>
              <div className="h-12 overflow-hidden rounded-xl bg-white/[0.06]">
                <div
                  className={`animate-grow h-full rounded-xl ${b.color}`}
                  style={{
                    width: `${(b.value / 5499) * 100}%`,
                    animationDelay: `${i * 300}ms`,
                  }}
                />
              </div>
              <p className="w-32 text-right font-display text-3xl font-bold tabular-nums">
                <CountUp to={b.value} active prefix="₹" />
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="animate-pop-in rounded-[2rem] bg-[#C6F432] p-10 text-left text-[#07090D]">
            <p className="text-xl font-semibold">Shopper saves</p>
            <p className="font-display text-[clamp(4rem,10vw,9rem)] font-bold leading-none">
              <CountUp to={450} active prefix="₹" />
            </p>
          </div>
          <div
            className="animate-pop-in rounded-[2rem] bg-[#FF8A3D] p-10 text-left text-[#07090D]"
            style={{ animationDelay: "250ms" }}
          >
            <p className="text-xl font-semibold">We keep, every deal</p>
            <p className="font-display text-[clamp(4rem,10vw,9rem)] font-bold leading-none">
              <CountUp to={100} active prefix="₹" />
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/* 6 ── Why now, what it runs on, how it grows */
const WHY_NOW = [
  "UPI made instant payment normal",
  "Card offers are everywhere",
  "AI agents can finally act for you",
];
const VERSUS = [
  { who: "Comparison apps", does: "show you the deal" },
  { who: "Shop bots", does: "haggle for the shop" },
  { who: "Platform agents", does: "pay the listed price" },
];
const GROWTH = [
  { tag: "Now", title: "Concierge" },
  { tag: "Next", title: "Cardholders lend offers" },
  { tag: "Later", title: "Agent haggles with sellers" },
];

function WhyNow({ line }: SceneProps) {
  return (
    <div className="grid w-full max-w-6xl items-start gap-12 md:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col gap-6 text-left">
        <Eyebrow>Why now</Eyebrow>
        <Headline>
          The rails <span className={ACCENT}>just arrived.</span>
        </Headline>
        <div className="flex flex-col gap-3">
          {WHY_NOW.map((w, i) => (
            <Reveal key={w} on from="-translate-x-4" delay={300 + i * 250}>
              <p className="flex items-center gap-3 text-xl">
                <span className="h-2 w-2 rounded-full bg-[#C6F432]" />
                {w}
              </p>
            </Reveal>
          ))}
        </div>
        <Reveal on={line >= 1} from="translate-y-6">
          <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.05] p-4 backdrop-blur-xl">
            {VERSUS.map((v) => (
              <p
                key={v.who}
                className="flex justify-between gap-4 text-base text-[#8A9087]"
              >
                <span>{v.who}</span>
                <span className="line-through decoration-[#FF8A3D]/70">
                  {v.does}
                </span>
              </p>
            ))}
            <p className="mt-1 flex justify-between gap-4 border-t border-white/10 pt-3 text-lg font-semibold">
              <span>{BRAND}</span>
              <span className="text-[#C6F432]">gets the deal for you</span>
            </p>
          </div>
        </Reveal>
      </div>
      <div className="flex flex-col gap-6">
        <Reveal on={line >= 2}>
          <div className="flex flex-col gap-3 rounded-[2rem] border border-white/10 bg-white/[0.05] p-6 backdrop-blur-xl">
            <p className="text-sm uppercase tracking-[0.3em] text-[#8A9087]">
              Building on
            </p>
            <div className="flex items-center justify-between rounded-2xl bg-white/10 px-5 py-4">
              <p className="font-display text-2xl font-bold">AgenticOrg</p>
              <p className="text-sm text-[#B9BDB4]">Pine Labs · the agent</p>
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-white/10 px-5 py-4">
              <p className="font-display text-2xl font-bold">UPI rails</p>
              <p className="text-sm text-[#B9BDB4]">Pine Labs · payments</p>
            </div>
          </div>
        </Reveal>
        <Reveal on={line >= 3}>
          <div className="grid grid-cols-3 gap-3">
            {GROWTH.map((g, i) => (
              <div
                key={g.tag}
                className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.05] p-4 text-left backdrop-blur-xl"
              >
                <p
                  className={`text-xs font-bold uppercase tracking-[0.3em] ${i === 0 ? "text-[#C6F432]" : "text-[#8A9087]"}`}
                >
                  {g.tag}
                </p>
                <p className="font-display text-lg font-bold leading-tight">
                  {g.title}
                </p>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </div>
  );
}

/* 7 ── Traction + close: counters, CTA and a scannable QR */
function Close({ line, stats }: SceneProps) {
  const [qr, setQr] = useState("");
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
    QRCode.toDataURL(url, {
      margin: 1,
      width: 480,
      color: { dark: "#0E1116", light: "#F4F1EA" },
    }).then(setQr);
  }, []);
  const num = (s: string) => Number(s.replace(/[^\d]/g, "")) || 0;
  const counters = [
    { label: "real shoppers today", value: num(stats.shoppers), prefix: "" },
    { label: "saved for them", value: num(stats.saved), prefix: "₹" },
  ].filter((c) => c.value);
  return (
    <div className="grid w-full max-w-6xl items-center gap-12 md:grid-cols-[1.4fr_1fr]">
      <div className="flex flex-col gap-8 text-left">
        {counters.length > 0 && (
          <div className="flex gap-10">
            {counters.map((c) => (
              <div
                key={c.label}
                className="flex flex-col gap-1 border-t-4 border-[#C6F432] pt-4"
              >
                <p className="font-display text-[clamp(3rem,7vw,6.5rem)] font-bold leading-none tabular-nums">
                  <CountUp
                    to={c.value}
                    active
                    prefix={c.prefix}
                    duration={2000}
                  />
                </p>
                <p className="text-lg text-[#B9BDB4]">{c.label}</p>
              </div>
            ))}
          </div>
        )}
        <Reveal on={line >= 1 || counters.length === 0}>
          <Headline className="text-[clamp(2.6rem,6vw,6.5rem)]">
            Buying something <span className={ACCENT}>today?</span>
          </Headline>
        </Reveal>
      </div>
      <Tilt className="mx-auto rounded-3xl" max={10}>
        <div className="animate-float flex flex-col items-center gap-4 rounded-3xl bg-[#F4F1EA] p-6 shadow-[0_0_80px_#C6F43240]">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element -- generated data: URL, nothing for next/image to optimise
            <img
              src={qr}
              alt={`QR code to open ${BRAND}`}
              className="h-56 w-56 sm:h-64 sm:w-64"
            />
          ) : (
            <div className="h-56 w-56 sm:h-64 sm:w-64" />
          )}
          <p className="font-display text-xl font-bold text-[#0E1116]">
            Scan · paste · haggle
          </p>
        </div>
      </Tilt>
    </div>
  );
}

const SCENES = [Cover, Problem, Insight, YourTurn, Money, WhyNow, Close];

export function Scene({
  seg,
  line,
  stats,
}: {
  seg: number;
  line: number;
  stats: PitchStats;
}) {
  const Current = SCENES[Math.min(seg, SCENES.length - 1)];
  // key on seg so each scene remounts and replays its entrance animations
  return (
    <div key={seg} className="animate-scene-in flex w-full justify-center">
      <Current line={line} stats={stats} />
    </div>
  );
}
