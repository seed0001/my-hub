export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessageInput {
  role: ChatRole;
  content: string;
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export function getModel(): string {
  return process.env.OPENROUTER_MODEL || "anthropic/claude-3.5-sonnet";
}

/**
 * Call OpenRouter's chat completions endpoint with streaming enabled.
 * Returns the raw Response so the route handler can pipe the stream through.
 */
export async function streamChat(messages: ChatMessageInput[]): Promise<Response> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set.");
  }

  const appUrl = process.env.APP_URL || "http://localhost:3000";

  return fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // OpenRouter attribution headers (optional but recommended).
      "HTTP-Referer": appUrl,
      "X-Title": "my-hub",
    },
    body: JSON.stringify({
      model: getModel(),
      messages,
      stream: true,
    }),
  });
}
