"use client";

import { useEffect, useRef, useState } from "react";
import { HAGGLE_PRODUCT } from "@/lib/pitch";
import { listenOnce, Tilt } from "./stage";

type Msg = { role: "user" | "assistant"; content: string };

const { title, store, listPrice, openingOffer, floor } = HAGGLE_PRODUCT;
const OPENING = `These ${title} list at ${listPrice.toLocaleString("en-IN")} rupees on ${store}. For you, ${openingOffer.toLocaleString("en-IN")}. Go on, make me an offer.`;
const CONFETTI = Array.from({ length: 36 }, (_, i) => i);

/** Live, interactive haggle: a judge bargains with the agent by voice or text; the server enforces the floor. */
export function LiveHaggle({
  speak,
  stopSpeech,
}: {
  speak: (text: string) => Promise<void>;
  stopSpeech: () => void;
}) {
  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", content: OPENING },
  ]);
  const [offer, setOffer] = useState(openingOffer);
  const [deal, setDeal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
  const [draft, setDraft] = useState("");
  const stopRef = useRef<(() => void) | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    speak(OPENING);
    return () => stopSpeech();
  }, [speak, stopSpeech]);

  useEffect(() => {
    logRef.current?.scrollTo({
      top: logRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, interim]);

  const send = async (text: string) => {
    if (!text.trim() || busy || deal) return;
    stopSpeech();
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setBusy(true);
    try {
      const res = await fetch("/api/pitch/haggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, offer }),
      });
      const turn = (await res.json()) as {
        reply: string;
        offer: number;
        deal: boolean;
      };
      setMessages([...next, { role: "assistant", content: turn.reply }]);
      setOffer(turn.offer);
      setDeal(turn.deal);
      setBusy(false);
      await speak(turn.reply);
    } catch {
      setBusy(false);
      setMessages([
        ...next,
        {
          role: "assistant",
          content: "My calculator just fainted. Say that again?",
        },
      ]);
    }
  };

  const mic = () => {
    if (listening) return stopRef.current?.();
    stopSpeech();
    setListening(true);
    const session = listenOnce(setInterim);
    if (!session) {
      setListening(false);
      return setInterim("Voice needs Chrome. Type your offer instead.");
    }
    stopRef.current = session.stop;
    session.done.then((text) => {
      setListening(false);
      setInterim("");
      send(text);
    });
  };

  const saved = listPrice - offer;
  const span = listPrice - (floor - 300);
  const markerPct = ((listPrice - offer) / span) * 100;

  return (
    <div className="grid w-full max-w-6xl items-stretch gap-8 md:grid-cols-[1fr_1.15fr]">
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#FF3D7F] opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-[#FF3D7F]" />
          </span>
          <p className="text-sm font-semibold uppercase tracking-[0.35em] text-[#FF3D7F]">
            Live · haggle with the agent
          </p>
        </div>
        <Tilt className="rounded-[2rem]">
          <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.04] p-8 backdrop-blur-xl">
            <p className="text-sm text-[#8A9087]">{store}</p>
            <p className="font-display text-3xl font-bold">{title}</p>
            <p className="mt-6 text-lg text-[#8A9087] line-through decoration-[#FF8A3D] decoration-2">
              ₹{listPrice.toLocaleString("en-IN")}
            </p>
            <p
              key={offer}
              className="animate-pop-in font-display text-[clamp(4rem,8vw,7rem)] font-bold leading-none tabular-nums text-[#C6F432] [text-shadow:0_0_40px_#C6F43266]"
            >
              ₹{offer.toLocaleString("en-IN")}
            </p>
            <p className="mt-3 text-xl">
              {saved > 0 ? (
                <>
                  You’ve squeezed out{" "}
                  <b className="text-[#C6F432]">
                    ₹{saved.toLocaleString("en-IN")}
                  </b>
                </>
              ) : (
                "Make your first offer"
              )}
            </p>
            <div className="relative mt-8 h-3 rounded-full bg-white/10">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${markerPct}%`,
                  background: "linear-gradient(90deg,#C6F432,#00D1B2)",
                }}
              />
              <div
                className="absolute -top-2 h-7 w-1 rounded bg-[#FF8A3D] transition-opacity duration-700"
                style={{
                  left: `${((listPrice - floor) / span) * 100}%`,
                  opacity: deal ? 1 : 0.25,
                }}
              />
            </div>
            <p className="mt-3 text-right text-sm text-[#FF8A3D]">
              {deal
                ? `Floor was ₹${floor.toLocaleString("en-IN")}. The agent never crossed it.`
                : "Secret floor: hidden"}
            </p>
            {deal && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <p className="animate-pop-in -rotate-12 rounded-2xl border-[6px] border-[#C6F432] bg-[#07090D]/70 px-8 py-2 font-display text-7xl font-bold text-[#C6F432]">
                  DEAL
                </p>
              </div>
            )}
          </div>
        </Tilt>
      </div>

      <div className="relative flex min-h-[28rem] flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.04] backdrop-blur-xl">
        <div
          ref={logRef}
          className="flex flex-1 flex-col gap-3 overflow-y-auto p-6"
        >
          {messages.map((m, i) => (
            <p
              key={i}
              className={`animate-pop-in max-w-[85%] rounded-2xl px-5 py-3 text-lg ${
                m.role === "user"
                  ? "self-end rounded-br-sm bg-[#C6F432] text-[#07090D]"
                  : "self-start rounded-bl-sm bg-white/10"
              }`}
            >
              {m.content}
            </p>
          ))}
          {interim && (
            <p className="max-w-[85%] self-end rounded-2xl rounded-br-sm border border-dashed border-[#C6F432] px-5 py-3 text-lg text-[#C6F432]">
              {interim}
            </p>
          )}
          {busy && (
            <p className="flex gap-1.5 self-start rounded-2xl bg-white/10 px-5 py-4">
              {[0, 1, 2].map((d) => (
                <span
                  key={d}
                  className="h-2.5 w-2.5 animate-bounce rounded-full bg-[#F4F1EA]"
                  style={{ animationDelay: `${d * 150}ms` }}
                />
              ))}
            </p>
          )}
        </div>
        <form
          className="flex items-center gap-3 border-t border-white/10 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
            setDraft("");
          }}
        >
          <button
            type="button"
            onClick={mic}
            className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full transition-all ${
              listening
                ? "scale-110 bg-[#FF3D7F] shadow-[0_0_40px_#FF3D7F]"
                : "bg-[#C6F432] text-[#07090D] hover:scale-105"
            }`}
            aria-label={listening ? "Stop listening" : "Speak your offer"}
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
              <path
                d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-7 9a7 7 0 0 0 14 0M12 19v3"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={deal}
            placeholder={
              deal
                ? "Deal closed 🎉"
                : "Type your offer… e.g. “4,000 and I pay now”"
            }
            className="flex-1 rounded-full border border-white/10 bg-black/30 px-5 py-4 text-lg outline-none focus:border-[#C6F432]"
          />
        </form>
      </div>

      {deal && (
        <div
          className="pointer-events-none fixed inset-0 overflow-hidden"
          aria-hidden
        >
          {CONFETTI.map((i) => (
            <span
              key={i}
              className="animate-confetti absolute top-[-5%] h-3 w-2 rounded-sm"
              style={{
                left: `${(i * 37) % 100}%`,
                background: ["#C6F432", "#FF8A3D", "#00D1B2", "#FF3D7F"][i % 4],
                animationDelay: `${(i % 12) * 90}ms`,
                animationDuration: `${2.2 + (i % 5) * 0.4}s`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
