import { anthropic } from "@ai-sdk/anthropic";

/** The model behind the agent's wording (it never sets prices) and chat intent fallback. */
export const model = anthropic(process.env.GHOSTCART_MODEL ?? "claude-sonnet-5-5");
