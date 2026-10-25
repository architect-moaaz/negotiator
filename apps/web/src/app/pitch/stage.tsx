"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Living backdrop for /pitch: drifting aurora blobs, a cursor spotlight, a perspective grid and film grain. */
export function Backdrop({
  mood = "lime",
  light = false,
}: {
  mood?: "lime" | "orange" | "live";
  light?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onMove = (e: PointerEvent) => {
      el.style.setProperty("--mx", `${(e.clientX / window.innerWidth) * 100}%`);
      el.style.setProperty(
        "--my",
        `${(e.clientY / window.innerHeight) * 100}%`,
      );
      el.style.setProperty(
        "--px",
        `${(e.clientX / window.innerWidth - 0.5) * 40}px`,
      );
      el.style.setProperty(
        "--py",
        `${(e.clientY / window.innerHeight - 0.5) * 40}px`,
      );
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  const [a, b, c] =
    mood === "orange"
      ? ["#FF8A3D", "#C6F432", "#7C3AED"]
      : mood === "live"
        ? ["#FF3D7F", "#FF8A3D", "#C6F432"]
        : ["#C6F432", "#00D1B2", "#7C3AED"];

  return (
    <div
      ref={ref}
      className={`pointer-events-none fixed inset-0 overflow-hidden transition-colors duration-700 ${light ? "bg-[#FAFAF7]" : "bg-[#07090D]"}`}
      aria-hidden
    >
      <div
        className="absolute inset-0 transition-transform duration-700 ease-out"
        style={{ transform: "translate(var(--px, 0), var(--py, 0))" }}
      >
        <div
          className={`animate-blob-a absolute -left-[10%] -top-[20%] h-[70vmax] w-[70vmax] rounded-full ${light ? "opacity-25" : "opacity-35"} blur-[120px] transition-colors duration-[2000ms]`}
          style={{ background: a }}
        />
        <div
          className={`animate-blob-b absolute -right-[15%] top-[10%] h-[60vmax] w-[60vmax] rounded-full ${light ? "opacity-20" : "opacity-25"} blur-[130px] transition-colors duration-[2000ms]`}
          style={{ background: b }}
        />
        <div
          className={`animate-blob-c absolute -bottom-[30%] left-[20%] h-[65vmax] w-[65vmax] rounded-full ${light ? "opacity-20" : "opacity-30"} blur-[140px] transition-colors duration-[2000ms]`}
          style={{ background: c }}
        />
      </div>
      {/* perspective floor grid */}
      <div className="absolute inset-x-0 bottom-0 h-[55%] [perspective:600px]">
        <div
          className="animate-grid absolute inset-0 origin-bottom [transform:rotateX(62deg)] opacity-40"
          style={{
            backgroundImage: light
              ? "linear-gradient(#0e111614 1px, transparent 1px), linear-gradient(90deg, #0e111614 1px, transparent 1px)"
              : "linear-gradient(#ffffff14 1px, transparent 1px), linear-gradient(90deg, #ffffff14 1px, transparent 1px)",
            backgroundSize: "64px 64px",
            maskImage: "linear-gradient(to top, black 10%, transparent 85%)",
          }}
        />
      </div>
      {/* cursor spotlight */}
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(600px circle at var(--mx, 50%) var(--my, 40%), ${light ? "#ffffffaa" : "#ffffff12"}, transparent 60%)`,
        }}
      />
      {/* film grain */}
      <div
        className="absolute inset-0 opacity-[0.07] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
      <div
        className={`absolute inset-0 ${light ? "bg-[radial-gradient(ellipse_at_center,transparent_50%,#FAFAF7_100%)]" : "bg-[radial-gradient(ellipse_at_center,transparent_40%,#07090D_100%)]"}`}
      />
    </div>
  );
}

/** Tilts its child in 3D toward the cursor, with a moving glare. */
export function Tilt({
  children,
  className = "",
  max = 12,
}: {
  children: ReactNode;
  className?: string;
  max?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onMove = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.transform = `perspective(900px) rotateX(${(0.5 - y) * max}deg) rotateY(${(x - 0.5) * max}deg) scale(1.03)`;
    el.style.setProperty("--gx", `${x * 100}%`);
    el.style.setProperty("--gy", `${y * 100}%`);
  };
  const onLeave = () => {
    if (ref.current) ref.current.style.transform = "";
  };
  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      className={`relative transition-transform duration-300 ease-out will-change-transform ${className}`}
    >
      {children}
      <div
        className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300 [div:hover>&]:opacity-100"
        style={{
          background:
            "radial-gradient(circle at var(--gx, 50%) var(--gy, 50%), #ffffff22, transparent 55%)",
        }}
      />
    </div>
  );
}

// Minimal Web Speech recognition typing (Chrome exposes it as webkitSpeechRecognition).
interface Recognizer {
  lang: string;
  interimResults: boolean;
  onresult:
    | ((e: {
        results: ArrayLike<
          ArrayLike<{ transcript: string }> & { isFinal: boolean }
        >;
      }) => void)
    | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}

/** Listen for one utterance. Returns null when the browser has no speech recognition (use Chrome). */
export function listenOnce(onInterim: (text: string) => void) {
  const w = window as unknown as Record<string, new () => Recognizer>;
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const r = new Ctor();
  r.lang = "en-IN";
  r.interimResults = true;
  let finalText = "";
  const done = new Promise<string>((resolve) => {
    r.onresult = (e) => {
      const parts = Array.from(e.results);
      onInterim(parts.map((p) => p[0].transcript).join(" "));
      finalText = parts
        .filter((p) => p.isFinal)
        .map((p) => p[0].transcript)
        .join(" ");
    };
    r.onend = () => resolve(finalText);
    r.onerror = () => resolve("");
  });
  r.start();
  return { stop: () => r.stop(), done };
}
