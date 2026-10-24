"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Space_Grotesk } from "next/font/google";
import {
  BRAND,
  parseLine,
  pitchScript,
  type PitchStats,
  type Voice,
} from "@/lib/pitch";
import { LiveHaggle } from "./haggle";
import { Scene } from "./scenes";
import { Backdrop, listenOnce } from "./stage";

const display = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

type Phase = "setup" | "pitching" | "paused" | "qa" | "haggle";
type Turn = { role: "user" | "assistant"; content: string };

const STATS_KEY = "ghostcart-pitch-stats";

// Fallback only: the most natural browser voice available (Premium/Enhanced/Natural first).
function pickVoice() {
  const voices = speechSynthesis
    .getVoices()
    .filter((v) => v.lang.startsWith("en"));
  const natural = (v: SpeechSynthesisVoice) =>
    /premium|enhanced|natural|neural/i.test(v.name);
  return (
    voices.find((v) => natural(v) && v.lang === "en-IN") ??
    voices.find(natural) ??
    voices.find((v) => v.lang === "en-IN" && /google/i.test(v.name)) ??
    voices.find((v) => /google (uk|us) english/i.test(v.name)) ??
    voices[0]
  );
}

function speakWithBrowser(text: string) {
  return new Promise<void>((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) u.voice = voice;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

// Natural TTS audio from /api/tts, cached per line so prefetching the next line makes playback gapless.
const audioCache = new Map<string, Promise<string | null>>();
let ttsAvailable = true;
let playing: { audio: HTMLAudioElement; done: () => void } | null = null;
// Lets the page show a visible warning instead of silently dropping to the robotic browser voice.
let onTtsError: ((message: string) => void) | null = null;

type VoiceMode = Voice | "duet";
const VOICE_MODES: VoiceMode[] = ["male", "female", "duet"];

/** Duet alternates voices scene by scene; Q&A and the live haggle use the male voice unless female is chosen. */
const voiceFor = (mode: VoiceMode, seg?: number): Voice =>
  mode === "duet"
    ? seg !== undefined && seg % 2 === 1
      ? "female"
      : "male"
    : mode;

// `line` may carry a "[tone] " prefix (see parseLine); the tone steers delivery.
function fetchSpeech(line: string, voice: Voice) {
  if (!ttsAvailable) return Promise.resolve(null);
  const key = `${voice}|${line}`;
  let url = audioCache.get(key);
  if (!url) {
    const { text, tone } = parseLine(line);
    url = fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, tone, voice }),
    })
      .then(async (res) => {
        if (res.status === 501) ttsAvailable = false;
        if (res.ok) {
          if (res.headers.get("X-Voice-Engine") === "kokoro")
            onTtsError?.(
              `${res.headers.get("X-Voice-Fallback-Reason")}: backup voice (Kokoro)`,
            );
          return URL.createObjectURL(await res.blob());
        }
        const { error } = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        onTtsError?.(`${error ?? "Natural voice unavailable"}: browser voice`);
        audioCache.delete(key); // retry next time, e.g. after credits are topped up
        return null;
      })
      .catch(() => null);
    audioCache.set(key, url);
  }
  return url;
}

function stopSpeech() {
  speechSynthesis.cancel();
  if (playing) {
    playing.audio.pause();
    playing.done();
    playing = null;
  }
}

async function speak(
  line: string,
  voice: Voice,
  next?: { line: string; voice: Voice },
) {
  const url = await fetchSpeech(line, voice);
  if (next) fetchSpeech(next.line, next.voice);
  if (!url) return speakWithBrowser(parseLine(line).text);
  return new Promise<void>((resolve) => {
    const audio = new Audio(url);
    const done = () => resolve();
    playing = { audio, done };
    audio.onended = done;
    audio.onerror = done;
    audio.play().catch(done);
  });
}

export default function PitchPage() {
  const [stats, setStats] = useState<PitchStats>({
    shoppers: "",
    payments: "",
    saved: "",
  });
  const [phase, setPhase] = useState<Phase>("setup");
  const [pos, setPos] = useState({ seg: 0, line: 0 });
  const [caption, setCaption] = useState("");
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [draft, setDraft] = useState("");
  const [history, setHistory] = useState<Turn[]>([]);
  const runId = useRef(0);
  const stopListening = useRef<(() => void) | null>(null);
  const [idle, setIdle] = useState(false);
  const [light, setLight] = useState(false);
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("male");
  // Subtitles compete with the voice for attention, so they're off unless asked for (C).
  const [captions, setCaptions] = useState(false);
  const [voiceWarning, setVoiceWarning] = useState("");

  useEffect(() => {
    onTtsError = setVoiceWarning;
    return () => {
      onTtsError = null;
    };
  }, []);
  const agentVoice = voiceFor(voiceMode);
  // The live haggle is the shopkeeper persona, so it always speaks in the playful tone.
  const speakAsHaggler = useCallback(
    (text: string) => speak(`[playful] ${text}`, agentVoice),
    [agentVoice],
  );

  const script = useMemo(() => pitchScript(stats), [stats]);
  const segment = script[Math.min(pos.seg, script.length - 1)];

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STATS_KEY);
      // One-time restore after hydration; reading localStorage during render would mismatch SSR.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setStats(JSON.parse(saved));
    } catch {}
    // ?scene=5.2 opens paused on scene 5, line 2 (1-based scene) for previewing visuals without audio.
    const params = new URLSearchParams(window.location.search);
    if (params.get("theme") === "light") setLight(true);
    const v = params.get("voice") as VoiceMode | null;
    if (v && VOICE_MODES.includes(v)) setVoiceMode(v);
    const preview = params.get("scene")?.split(".").map(Number);
    if (preview?.[0]) {
      setPos({ seg: preview[0] - 1, line: preview[1] ?? 0 });
      setPhase("paused");
    }
    speechSynthesis.getVoices(); // warm the voice list
    fetchSpeech(
      pitchScript({ shoppers: "", payments: "", saved: "" })[0].lines[0],
      "male",
    ); // opening line plays instantly
    return () => stopSpeech();
  }, []);

  const updateStats = (patch: Partial<PitchStats>) => {
    const next = { ...stats, ...patch };
    setStats(next);
    try {
      localStorage.setItem(STATS_KEY, JSON.stringify(next));
    } catch {}
  };

  const run = useCallback(
    async (from: { seg: number; line: number }) => {
      const id = ++runId.current;
      stopSpeech();
      setPhase("pitching");
      for (let s = from.seg; s < script.length; s++) {
        for (
          let l = s === from.seg ? from.line : 0;
          l < script[s].lines.length;
          l++
        ) {
          if (runId.current !== id) return;
          setPos({ seg: s, line: l });
          setCaption(parseLine(script[s].lines[l]).text);
          const nextLine = script[s].lines[l + 1] ?? script[s + 1]?.lines[0];
          const nextSeg = script[s].lines[l + 1] ? s : s + 1;
          await speak(
            script[s].lines[l],
            voiceFor(voiceMode, s),
            nextLine
              ? { line: nextLine, voice: voiceFor(voiceMode, nextSeg) }
              : undefined,
          );
        }
        // A live segment hands the stage to the interactive haggle; "Continue" resumes after it.
        if (script[s].live && runId.current === id) return setPhase("haggle");
      }
      if (runId.current === id) setPhase("qa");
    },
    [script, voiceMode],
  );

  const pause = () => {
    runId.current++;
    stopSpeech();
    setPhase("paused");
  };

  const jump = (seg: number) =>
    run({ seg: Math.max(0, Math.min(script.length - 1, seg)), line: 0 });

  const ask = useCallback(
    async (question: string) => {
      if (!question.trim()) return;
      runId.current++;
      stopSpeech();
      setPhase("qa");
      setThinking(true);
      setCaption(`“${question}”`);
      let answer: string;
      try {
        const res = await fetch("/api/pitch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, history, stats }),
        });
        if (!res.ok) throw new Error(await res.text());
        answer =
          (await res.json()).answer ||
          "Great question. I'll hand that one over to my team.";
      } catch {
        answer = "Great question. I'll hand that one over to my team.";
      }
      setThinking(false);
      setHistory((h) => [
        ...h,
        { role: "user", content: question },
        { role: "assistant", content: answer },
      ]);
      setCaption(answer);
      await speak(answer, agentVoice);
    },
    [history, stats, agentVoice],
  );

  const listen = () => {
    if (listening) return stopListening.current?.();
    runId.current++;
    stopSpeech();
    const session = listenOnce(setCaption);
    if (!session)
      return setCaption("Voice input needs Chrome. Type the question instead.");
    stopListening.current = session.stop;
    setListening(true);
    setPhase("qa");
    session.done.then((text) => {
      setListening(false);
      if (text) ask(text);
    });
  };

  const cycleVoice = () => {
    stopSpeech();
    runId.current++;
    if (phase === "pitching") setPhase("paused");
    setVoiceMode(
      (m) => VOICE_MODES[(VOICE_MODES.indexOf(m) + 1) % VOICE_MODES.length],
    );
  };

  const haggle = () => {
    runId.current++;
    stopSpeech();
    setPhase("haggle");
  };

  // Hide the controls while the pitch plays; any mouse movement brings them back for a few seconds.
  useEffect(() => {
    let timer = setTimeout(() => setIdle(true), 2500);
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), 2500);
    };
    window.addEventListener("pointermove", wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", wake);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === " ") {
        e.preventDefault();
        if (phase === "pitching") pause();
        else if (phase === "setup" || phase === "paused") run(pos);
        else if (phase === "haggle") jump(pos.seg + 1);
      } else if (e.key === "ArrowRight") jump(pos.seg + 1);
      else if (e.key === "ArrowLeft") jump(pos.seg - 1);
      else if (e.key.toLowerCase() === "q") listen();
      else if (e.key.toLowerCase() === "h") haggle();
      else if (e.key.toLowerCase() === "t") setLight((l) => !l);
      else if (e.key.toLowerCase() === "v") cycleVoice();
      else if (e.key.toLowerCase() === "c") setCaptions((c) => !c);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const inScene = phase === "pitching" || phase === "paused";
  const dockHidden = idle && (phase === "pitching" || phase === "haggle");

  return (
    <div
      className={`${display.variable} relative flex min-h-screen flex-1 flex-col overflow-hidden ${light ? "pitch-light text-[#0E1116]" : "text-[#F4F1EA]"}`}
    >
      <Backdrop
        light={light}
        mood={
          phase === "haggle" ? "live" : pos.seg % 3 === 1 ? "orange" : "lime"
        }
      />

      <div
        className="relative flex h-1 w-full gap-1 px-6 pt-4 sm:px-12"
        aria-hidden
      >
        {script.map((s, i) => (
          <div
            key={s.slide}
            className="h-1 flex-1 overflow-hidden rounded-full bg-white/10"
          >
            <div
              className="h-full rounded-full bg-[#C6F432] shadow-[0_0_10px_#C6F432] transition-all duration-700"
              style={{
                width:
                  phase === "qa" ||
                  i < pos.seg ||
                  (phase === "haggle" && i === pos.seg)
                    ? "100%"
                    : i === pos.seg && phase !== "setup"
                      ? `${((pos.line + 1) / s.lines.length) * 100}%`
                      : "0%",
              }}
            />
          </div>
        ))}
      </div>
      {voiceWarning && (
        <button
          onClick={() => setVoiceWarning("")}
          className="fixed right-6 top-14 z-20 rounded-full bg-[#FF3D7F] px-4 py-2 text-sm font-semibold text-[#07090D] shadow-lg"
          title="Dismiss"
        >
          ⚠ {voiceWarning} ✕
        </button>
      )}
      <header className="relative flex items-center justify-between px-6 py-5 sm:px-12">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-[#C6F432]">
          {BRAND} · Live pitch
        </p>
        <p className="text-sm text-[#8A9087]">
          {phase === "qa"
            ? "Q&A"
            : phase === "haggle"
              ? "Live demo"
              : `${segment.slide} / ${script.length}`}
        </p>
      </header>

      {inScene ? (
        <main className="relative flex flex-1 flex-col items-center justify-center gap-10 px-6 pb-28 sm:px-12">
          <Scene seg={pos.seg} line={pos.line} stats={stats} />
          {captions && (
            <p
              key={caption}
              className="animate-scene-in max-w-4xl text-center text-lg text-[#D9DCD3] [text-shadow:0_2px_12px_#000] sm:text-2xl"
            >
              {caption}
            </p>
          )}
        </main>
      ) : phase === "haggle" ? (
        <main className="relative flex flex-1 items-center justify-center px-6 pb-28 sm:px-12">
          <LiveHaggle speak={speakAsHaggler} stopSpeech={stopSpeech} />
        </main>
      ) : (
        <main className="relative flex flex-1 flex-col items-center justify-center gap-10 px-6 pb-40 text-center sm:px-12">
          <div
            className={`h-32 w-32 rounded-full transition-all duration-500 ${
              listening
                ? "scale-110 bg-[#FF3D7F] shadow-[0_0_120px_#FF3D7F]"
                : thinking
                  ? "animate-pulse bg-[#C6F432]/60 shadow-[0_0_80px_#C6F43266]"
                  : "animate-float bg-[radial-gradient(circle_at_30%_30%,#F4FFD0,#C6F432_45%,#5E7A12)] shadow-[0_0_100px_#C6F43280]"
            }`}
            aria-hidden
          />
          {phase === "setup" ? (
            <div className="flex w-full max-w-2xl flex-col gap-6">
              <h1 className="animate-rise font-display text-5xl font-bold tracking-tight sm:text-7xl">
                Ready to{" "}
                <span className="bg-[linear-gradient(90deg,#C6F432,#00D1B2,#C6F432)] bg-[length:200%_auto] bg-clip-text text-transparent animate-shimmer">
                  pitch
                </span>
              </h1>
              <p className="text-lg text-[#B9BDB4]">
                Fill in today’s real numbers. The agent says them in the close
                and uses them in Q&amp;A. Leave blank to skip.
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {(
                  [
                    ["shoppers", "Real shoppers"],
                    ["payments", "UPI payments"],
                    ["saved", "₹ saved"],
                  ] as const
                ).map(([key, label]) => (
                  <label
                    key={key}
                    className="flex flex-col gap-2 text-left text-sm text-[#8A9087]"
                  >
                    {label}
                    <input
                      value={stats[key]}
                      onChange={(e) => updateStats({ [key]: e.target.value })}
                      className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xl text-[#F4F1EA] outline-none backdrop-blur focus:border-[#C6F432]"
                      placeholder="—"
                    />
                  </label>
                ))}
              </div>
              <button
                onClick={async () => {
                  const res = await fetch("/api/ticker", {
                    cache: "no-store",
                  }).catch(() => null);
                  const data = res?.ok
                    ? ((await res.json()) as {
                        stats: { users: number; paid: number; saved: number };
                      })
                    : null;
                  if (!data) return;
                  const { users, paid, saved } = data.stats;
                  updateStats({
                    shoppers: users ? String(users) : "",
                    payments: paid ? String(paid) : "",
                    saved: saved ? saved.toLocaleString("en-IN") : "",
                  });
                }}
                className="self-start rounded-full border border-white/10 px-5 py-2 text-sm text-[#B9BDB4] hover:border-[#C6F432]"
              >
                Use live numbers from the app
              </button>
            </div>
          ) : (
            <p className="font-display max-w-5xl text-3xl font-semibold leading-snug tracking-tight sm:text-5xl">
              {thinking ? "Thinking…" : caption || "Ask me anything."}
            </p>
          )}
        </main>
      )}

      <footer
        className={`fixed inset-x-0 bottom-6 z-10 flex flex-col items-center gap-3 px-6 transition-all duration-500 ${dockHidden ? "pointer-events-none translate-y-6 opacity-0" : "opacity-100"}`}
      >
        <div className="flex flex-wrap justify-center gap-2 rounded-full border border-white/10 bg-black/40 p-2 shadow-2xl backdrop-blur-xl">
          {phase === "pitching" ? (
            <button
              onClick={pause}
              className="rounded-full bg-[#F4F1EA] px-6 py-3 font-semibold text-[#07090D]"
            >
              Pause
            </button>
          ) : (
            <button
              onClick={() =>
                phase === "haggle"
                  ? jump(pos.seg + 1)
                  : run(phase === "qa" ? { seg: 0, line: 0 } : pos)
              }
              className="rounded-full bg-[#C6F432] px-6 py-3 font-semibold text-[#07090D] transition hover:shadow-[0_0_30px_#C6F432]"
            >
              {phase === "setup"
                ? "Start pitch"
                : phase === "paused"
                  ? "Resume"
                  : phase === "haggle"
                    ? "Continue ▶"
                    : "Replay pitch"}
            </button>
          )}
          {inScene && (
            <button
              onClick={() => jump(pos.seg + 1)}
              className="rounded-full px-5 py-3 hover:bg-white/10"
            >
              Next
            </button>
          )}
          <button
            onClick={haggle}
            className={`rounded-full px-5 py-3 font-semibold transition ${phase === "haggle" ? "bg-[#FF3D7F] text-[#07090D]" : "text-[#FF8FB3] hover:bg-white/10"}`}
          >
            ● Haggle live
          </button>
          <button
            onClick={listen}
            className={`rounded-full px-5 py-3 font-semibold transition ${listening ? "bg-[#FF3D7F] text-[#07090D]" : "hover:bg-white/10"}`}
          >
            {listening ? "Listening… tap to stop" : "Ask by voice"}
          </button>
          <button
            onClick={cycleVoice}
            className="rounded-full px-5 py-3 transition hover:bg-white/10"
            title="Male, female, or a duet that alternates by scene"
          >
            {voiceMode === "duet"
              ? "♂♀ Duet"
              : voiceMode === "female"
                ? "♀ Female"
                : "♂ Male"}
          </button>
          <button
            onClick={() => setLight((l) => !l)}
            className="rounded-full px-5 py-3 transition hover:bg-white/10"
            title="Switch light / dark theme"
          >
            {light ? "☾ Dark" : "☀︎ Light"}
          </button>
          <button
            onClick={() => setCaptions((c) => !c)}
            className={`rounded-full px-5 py-3 transition ${captions ? "bg-white/10" : "hover:bg-white/10"}`}
            title="Show subtitles under each scene"
          >
            CC
          </button>
        </div>
        {(phase === "qa" || phase === "setup") && (
          <form
            className="flex w-full max-w-2xl gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              ask(draft);
              setDraft("");
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Or type a judge’s question…"
              className="flex-1 rounded-full border border-white/10 bg-black/40 px-5 py-3 outline-none backdrop-blur-xl focus:border-[#C6F432]"
            />
            <button
              className="rounded-full border border-white/10 bg-black/40 px-5 py-3 backdrop-blur-xl"
              disabled={thinking}
            >
              Ask
            </button>
          </form>
        )}
        <p className="text-xs text-[#8A9087]">
          Space start/pause/continue · ←/→ scenes · H haggle · Q ask · V voice ·
          C subtitles · T theme
        </p>
      </footer>
    </div>
  );
}
