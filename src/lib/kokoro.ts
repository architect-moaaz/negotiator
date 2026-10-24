import type { KokoroTTS } from "kokoro-js";
import type { Voice } from "@/lib/pitch";

/** Local, open-source backup voice (Kokoro-82M on CPU). Used when ElevenLabs is unavailable. */

const VOICES: Record<Voice, "af_heart" | "am_michael"> = {
  male: "am_michael",
  female: "af_heart",
};

let model: Promise<KokoroTTS> | null = null;

function load() {
  model ??= import("kokoro-js").then(({ KokoroTTS }) =>
    KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
      dtype: "q8",
      device: "cpu",
    }),
  );
  model.catch(() => (model = null)); // let a later request retry a failed download
  return model;
}

/** Synthesise `text` as a WAV file. Kokoro has no emotion control, so tone is carried by speed. */
export async function kokoroSpeech(text: string, voice: Voice, speed: number) {
  const tts = await load();
  const audio = await tts.generate(text, { voice: VOICES[voice], speed });
  return Buffer.from(audio.toWav());
}
