"use client";

import QRCode from "qrcode";
import { useEffect, useState, type ReactNode } from "react";
import {
  BRAND,
  EXAMPLE_DEAL,
  HAGGLE_PRODUCT,
  PITCH_URL,
  type PitchStats,
} from "@/lib/pitch";
import { Tilt } from "./stage";

/** Animated visuals for the voice pitch: one scene per script segment, revealed line by line as the agent speaks. */

type SceneProps = { line: number; stats: PitchStats };

const LIME = "#C6F432";
const inr = (n: number) => n.toLocaleString("en-IN");
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

/* 1 ── Cold open, full screen: a giant price that gets haggled down */
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
            ₹{inr(HAGGLE_PRODUCT.listPrice)}
          </p>
          <Reveal
            on={line >= 2}
            from="translate-y-6 scale-90"
            className="absolute -bottom-10 -right-8 rotate-[-6deg]"
          >
            <p className="rounded-3xl bg-[#C6F432] px-8 py-4 font-display text-[clamp(2.5rem,5vw,4.5rem)] font-bold text-[#07090D] shadow-[0_0_80px_#C6F43299]">
              ₹{inr(EXAMPLE_DEAL.pays)}
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
      <Reveal
        on={line >= 2}
        from="scale-75"
        className="absolute bottom-[8%] left-[2%]"
      >
        <p className="rotate-3 rounded-2xl bg-white/10 px-5 py-3 text-lg font-semibold shadow-xl ring-1 ring-white/20">
          + free coriander 🌿
        </p>
      </Reveal>
      <Ghost className="animate-float absolute -right-2 top-0 hidden w-24 md:block" />
    </div>
  );
}

/* 2 ── Problem: eight stores, eight prices, and a buy button that won't bargain */
const STORES = [
  { name: "Amazon", price: 5499, best: true },
  { name: "Flipkart", price: 5649 },
  { name: "Myntra", price: 5599 },
  { name: "Ajio", price: 5799 },
  { name: "Tata CLiQ", price: 5699 },
  { name: "Nykaa", price: 5749 },
  { name: "Croma", price: 0 },
  { name: "Reliance Digital", price: 0 },
];
const STICKERS = [
  { text: "Price: fixed", tilt: "-rotate-3" },
  { text: "Bargaining: disabled", tilt: "rotate-2" },
  { text: "Buy now: judging you 👀", tilt: "-rotate-1" },
];

function Problem({ line }: SceneProps) {
  return (
    <div className="flex w-full max-w-6xl flex-col gap-10">
      <div className="flex flex-col gap-4 text-left">
        <Eyebrow>The problem</Eyebrow>
        <Headline>
          Eight stores. <span className={ACCENT}>Nobody to bargain with.</span>
        </Headline>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {STORES.map((s, i) => (
          <div
            key={s.name}
            className="animate-pop-in"
            style={{ animationDelay: `${i * 110}ms` }}
          >
            <Tilt className="rounded-2xl" max={14}>
              <div
                className={`rounded-2xl border p-4 text-left shadow-2xl backdrop-blur-xl ${
                  s.best
                    ? "border-[#C6F432]/60 bg-[#C6F432]/10"
                    : "border-white/10 bg-white/[0.05]"
                }`}
              >
                <p className="text-sm text-[#8A9087]">{s.name}</p>
                <p
                  className={`font-display text-2xl font-bold sm:text-3xl ${s.price ? "" : "text-[#8A9087]"}`}
                >
                  {s.price ? `₹${inr(s.price)}` : "Not stocked"}
                </p>
              </div>
            </Tilt>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-4">
        {STICKERS.map((st, i) => (
          <Reveal
            key={st.text}
            on={line >= 1}
            from="scale-75 translate-y-4"
            delay={i * 160}
          >
            <p
              className={`${st.tilt} rounded-xl border-2 border-dashed border-[#FF8A3D] px-4 py-2 font-display text-xl font-bold text-[#FF8A3D]`}
            >
              {st.text}
            </p>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

/* 3 ── How it works: four little screens from the real app */
function HowItWorks({ line }: SceneProps) {
  const card =
    "flex h-full flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.05] p-5 text-left shadow-2xl backdrop-blur-xl";
  return (
    <div className="flex w-full max-w-6xl flex-col gap-10">
      <div className="flex flex-col gap-4 text-left">
        <Eyebrow>How it works</Eyebrow>
        <Headline>
          Paste. Compare. <span className={ACCENT}>Haggle. Lock.</span>
        </Headline>
      </div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-4">
        <Reveal on from="translate-y-8" delay={200}>
          <div className={card}>
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-[#C6F432]">
              1 · Paste
            </p>
            <p className="self-end rounded-2xl rounded-br-sm bg-[#25D366] px-4 py-2 text-[#07090D]">
              amazon.in/dp/B0…
            </p>
            <p className="self-end rounded-2xl rounded-br-sm bg-white/10 px-4 py-2 text-sm">
              📸 cart screenshot
            </p>
            <p className="mt-auto text-sm text-[#8A9087]">Web or WhatsApp</p>
          </div>
        </Reveal>
        <Reveal on from="translate-y-8" delay={600}>
          <div className={card}>
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-[#C6F432]">
              2 · Compare
            </p>
            {STORES.slice(0, 4).map((st) => (
              <p key={st.name} className="flex justify-between text-sm">
                <span className="text-[#B9BDB4]">{st.name}</span>
                <span className={st.best ? "font-bold text-[#C6F432]" : ""}>
                  ₹{inr(st.price)}
                </span>
              </p>
            ))}
            <p className="mt-auto text-sm text-[#8A9087]">
              8 stores, checked live
            </p>
          </div>
        </Reveal>
        <Reveal on={line >= 1} from="translate-y-8">
          <div className={card}>
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-[#C6F432]">
              3 · Haggle
            </p>
            <p className="self-end rounded-2xl rounded-br-sm bg-[#C6F432] px-4 py-2 text-[#07090D]">
              5,000?
            </p>
            <p className="self-start rounded-2xl rounded-bl-sm bg-white/10 px-4 py-2 text-sm">
              5,000? My calculator fainted. 5,299, final-final.
            </p>
            <p className="mt-auto text-sm text-[#8A9087]">Up to 4 rounds</p>
          </div>
        </Reveal>
        <Reveal on={line >= 1} from="translate-y-8" delay={400}>
          <div className="flex h-full flex-col gap-2 rounded-2xl bg-[#F1EEE4] p-5 text-left text-[#1C1A26] shadow-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-[#6F6A7D]">
              4 · Lock
            </p>
            <p className="font-display text-3xl font-bold">₹9 UPI</p>
            <p className="text-sm">Pine Labs · price held 3:00</p>
            <p className="mt-auto text-sm text-[#6F6A7D]">
              Then 30 min to check out · tracked to your door
            </p>
          </div>
        </Reveal>
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
        Haggle with the agent. Go low enough and a human has to approve.
      </p>
    </div>
  );
}

/* 5 ── Money: the commission, split between the shopper and us */
function Money({ line }: SceneProps) {
  const { listPrice, commission, floor } = HAGGLE_PRODUCT;
  const { saves, keeps } = EXAMPLE_DEAL;
  return (
    <div className="flex w-full max-w-6xl flex-col gap-10">
      <div className="flex flex-col gap-4 text-left">
        <Eyebrow>The money</Eyebrow>
        <Headline>
          Who pays? <span className={ACCENT}>Not me.</span>
        </Headline>
      </div>
      {line < 1 ? (
        <div className="flex flex-col gap-4">
          <div className="relative h-20 overflow-hidden rounded-2xl bg-white/[0.06]">
            <div
              className="animate-grow absolute inset-y-0 left-0 rounded-l-2xl bg-[#4A5058]"
              style={{
                width: `${((listPrice - commission) / listPrice) * 100}%`,
              }}
            />
            <div
              className="animate-grow absolute inset-y-0 right-0 bg-[#C6F432]"
              style={{
                width: `${(commission / listPrice) * 100 * 6}%`,
                animationDelay: "500ms",
              }}
            />
            <p className="absolute inset-y-0 left-6 flex items-center font-display text-3xl font-bold tabular-nums">
              ₹{inr(listPrice)} sneakers
            </p>
            <p className="absolute inset-y-0 right-6 flex items-center font-display text-3xl font-bold text-[#07090D]">
              <CountUp to={commission} active prefix="₹" /> commission
            </p>
          </div>
          <p className="text-left text-lg text-[#B9BDB4]">
            Bar not to scale. The commission is about 8%, we just made it bigger
            so you can see it.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="animate-pop-in rounded-[2rem] bg-[#C6F432] p-10 text-left text-[#07090D]">
            <p className="text-xl font-semibold">You save</p>
            <p className="font-display text-[clamp(4rem,10vw,9rem)] font-bold leading-none">
              <CountUp to={saves} active prefix="₹" />
            </p>
          </div>
          <div
            className="animate-pop-in rounded-[2rem] bg-[#FF8A3D] p-10 text-left text-[#07090D]"
            style={{ animationDelay: "250ms" }}
          >
            <p className="text-xl font-semibold">We keep</p>
            <p className="font-display text-[clamp(4rem,10vw,9rem)] font-bold leading-none">
              <CountUp to={keeps} active prefix="₹" />
            </p>
          </div>
          <p className="text-left text-lg text-[#B9BDB4] sm:col-span-2">
            Floor ₹{inr(floor)}, enforced in code. The AI talks, the code does
            the maths.
          </p>
        </div>
      )}
      <Reveal on={line >= 2} from="translate-y-6">
        <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.05] px-6 py-4 backdrop-blur-xl">
          <p className="font-display text-2xl font-bold">Seller on {BRAND}?</p>
          <p className="text-lg text-[#B9BDB4]">
            Their margin funds the deal. They set the budget, the agent does the
            sweet talking.
          </p>
        </div>
      </Reveal>
    </div>
  );
}

/* 6 ── Agent + human: the escalation path, then the competitor line */
const DESK = [
  { who: "Your offer", what: "typed or spoken" },
  { who: "Seller agent", what: "approves small discounts alone" },
  { who: "AgenticOrg agent", what: "reviews via MCP, recommends" },
  { who: "A real human", what: "approves on the dashboard or a call" },
  { who: "Pine Labs UPI", what: "₹9 locks the price" },
];
const VERSUS = [
  { who: "Comparison apps", does: "tell you where it’s cheapest" },
  { who: "Shop bots", does: "haggle for the store" },
];

function AgentDesk({ line }: SceneProps) {
  return (
    <div className="flex w-full max-w-6xl flex-col gap-10">
      <div className="flex flex-col gap-4 text-left">
        <Eyebrow>Agent + human</Eyebrow>
        <Headline>
          Big discounts <span className={ACCENT}>need a human.</span>
        </Headline>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        {DESK.map((d, i) => (
          <Reveal
            key={d.who}
            on={i < 2 || line >= 1}
            from="translate-y-6"
            delay={(i < 2 ? i : i - 2) * 250}
          >
            <div
              className={`relative flex h-full flex-col gap-1 rounded-2xl border p-4 text-left backdrop-blur-xl ${
                i === 3
                  ? "border-[#FF8A3D] bg-[#FF8A3D]/10"
                  : "border-white/10 bg-white/[0.05]"
              }`}
            >
              <p className="font-display text-xl font-bold">{d.who}</p>
              <p className="text-sm text-[#B9BDB4]">{d.what}</p>
              {i < DESK.length - 1 && (
                <span className="absolute -right-3 top-1/2 hidden -translate-y-1/2 text-[#C6F432] md:block">
                  →
                </span>
              )}
            </div>
          </Reveal>
        ))}
      </div>
      <Reveal on={line >= 2} from="translate-y-6">
        <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.05] p-5 backdrop-blur-xl md:max-w-2xl">
          {VERSUS.map((v) => (
            <p
              key={v.who}
              className="flex justify-between gap-4 text-lg text-[#8A9087]"
            >
              <span>{v.who}</span>
              <span>{v.does}</span>
            </p>
          ))}
          <p className="mt-1 flex justify-between gap-4 border-t border-white/10 pt-3 text-xl font-semibold">
            <span>{BRAND}</span>
            <span className="text-[#C6F432]">haggles for you · 8 stores</span>
          </p>
        </div>
      </Reveal>
    </div>
  );
}

/* 7 ── Traction + close: counters, CTA and a scannable QR */
function Close({ line, stats }: SceneProps) {
  const [qr, setQr] = useState("");
  useEffect(() => {
    const url = PITCH_URL;
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
          <p className="-mt-3 text-sm text-[#0E1116]/70">
            {PITCH_URL.replace(/^https?:\/\//, "").replace(/\/$/, "")}
          </p>
        </div>
      </Tilt>
    </div>
  );
}

const SCENES = [Cover, Problem, HowItWorks, YourTurn, Money, AgentDesk, Close];

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
