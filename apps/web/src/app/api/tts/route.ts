import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { kokoroSpeech } from "@/lib/kokoro";
import type { Tone, Voice } from "@/lib/pitch";

// Generated lines are cached on disk so rehearsals don't spend ElevenLabs credits (or Kokoro CPU) twice.
const CACHE_DIR = path.join(tmpdir(), "pitch-tts-cache");

// After ElevenLabs runs out of credits, skip it for a while instead of paying a failed round trip per line.
const SKIP_ELEVENLABS_MS = 5 * 60_000;
let elevenLabsDownUntil = 0;

async function cachedAudio(
  parts: unknown[],
  ext: "mp3" | "wav",
  make: () => Promise<Buffer>,
) {
  const file = path.join(
    CACHE_DIR,
    `${createHash("sha256").update(JSON.stringify(parts)).digest("hex")}.${ext}`,
  );
  const hit = await readFile(file).catch(() => null);
  if (hit) return hit;
  const audio = await make();
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, audio).catch(() => {});
  return audio;
}

// ElevenLabs premade voices; override with ELEVENLABS_VOICE_MALE / ELEVENLABS_VOICE_FEMALE.
const VOICES: Record<Voice, string> = {
  male:
    process.env.ELEVENLABS_VOICE_MALE ||
    process.env.ELEVENLABS_VOICE_ID ||
    "JBFqnCBsd6RMkjVDRZzb",
  female: process.env.ELEVENLABS_VOICE_FEMALE || "EXAVITQu4vr4xnSDxMaL",
};

// Lower stability + higher style = more expressive; speed nudges pace per mood.
const TONES: Record<Tone, { stability: number; style: number; speed: number }> =
  {
    excited: { stability: 0.28, style: 0.7, speed: 1.08 },
    playful: { stability: 0.32, style: 0.6, speed: 1.04 },
    confident: { stability: 0.5, style: 0.4, speed: 1.0 },
    warm: { stability: 0.55, style: 0.35, speed: 0.97 },
    calm: { stability: 0.65, style: 0.2, speed: 0.95 },
    serious: { stability: 0.7, style: 0.25, speed: 0.93 },
    dramatic: { stability: 0.4, style: 0.65, speed: 0.88 },
  };

async function elevenLabsSpeech(text: string, voice: Voice, tone: Tone) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ElevenLabs key not set");
  if (Date.now() < elevenLabsDownUntil)
    throw new Error("ElevenLabs credits used up");
  const { stability, style, speed } = TONES[tone] ?? TONES.warm;
  const voiceId = VOICES[voice] ?? VOICES.male;
  const modelId = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";
  return cachedAudio(
    ["elevenlabs", voiceId, modelId, tone, text],
    "mp3",
    async () => {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          body: JSON.stringify({
            text,
            model_id: modelId,
            voice_settings: {
              stability,
              similarity_boost: 0.8,
              style,
              speed,
              use_speaker_boost: true,
            },
          }),
        },
      );
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      if ((await res.text()).includes("quota_exceeded")) {
        elevenLabsDownUntil = Date.now() + SKIP_ELEVENLABS_MS;
        throw new Error("ElevenLabs credits used up");
      }
      throw new Error(`ElevenLabs error ${res.status}`);
    },
  );
}

/** POST: speak one line. ElevenLabs first; Kokoro (local, open source) as the backup; 502 only if both fail. */
export async function POST(request: Request) {
  const {
    text,
    voice = "male",
    tone = "warm",
  } = (await request.json()) as { text?: string; voice?: Voice; tone?: Tone };
  if (!text?.trim())
    return Response.json({ error: "text is required" }, { status: 400 });

  let reason: string;
  try {
    const audio = await elevenLabsSpeech(text, voice, tone);
    return new Response(new Uint8Array(audio), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        "X-Voice-Engine": "elevenlabs",
      },
    });
  } catch (e) {
    reason = (e as Error).message;
  }

  try {
    const speed = (TONES[tone] ?? TONES.warm).speed;
    const audio = await cachedAudio(["kokoro", voice, speed, text], "wav", () =>
      kokoroSpeech(text, voice, speed),
    );
    return new Response(new Uint8Array(audio), {
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-store",
        "X-Voice-Engine": "kokoro",
        "X-Voice-Fallback-Reason": reason,
      },
    });
  } catch {
    return Response.json(
      { error: `${reason}, and the backup voice failed` },
      { status: 502 },
    );
  }
}
