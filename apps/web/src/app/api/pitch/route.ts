import { generateText, type ModelMessage } from "ai";
import { model } from "@/lib/agent";
import { qaInstructions, type PitchStats } from "@/lib/pitch";

/** POST: answer a judge's question in a short, speakable reply. */
export async function POST(request: Request) {
  const { question, history = [], stats } = (await request.json()) as {
    question?: string;
    history?: { role: "user" | "assistant"; content: string }[];
    stats: PitchStats;
  };
  if (!question?.trim()) return Response.json({ error: "question is required" }, { status: 400 });

  const messages: ModelMessage[] = [...history.slice(-8), { role: "user", content: question }];
  const { text, finishReason } = await generateText({
    model,
    instructions: qaInstructions(stats),
    messages,
    maxOutputTokens: 1500,
  });

  // If the reply hit the token cap, drop the half-finished sentence so it isn't spoken cut off.
  let answer = text.trim();
  if (finishReason === "length") answer = answer.slice(0, answer.search(/[.!?][^.!?]*$/) + 1) || answer;

  return Response.json({ answer });
}
