export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessageInput {
  role: ChatRole;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export function getModel(): string {
  return process.env.OPENROUTER_MODEL || "anthropic/claude-3.5-sonnet";
}

/**
 * Call OpenRouter's chat completions endpoint with streaming enabled.
 * Returns the raw Response so the caller can parse the SSE stream.
 */
export async function streamChat(
  messages: ChatMessageInput[],
  tools?: unknown
): Promise<Response> {
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
      ...(tools ? { tools, tool_choice: "auto" } : {}),
    }),
  });
}

/**
 * Parse an OpenRouter/OpenAI SSE stream. Text deltas are forwarded to
 * `onText` as they arrive; tool-call deltas are accumulated and returned
 * complete once the stream ends.
 */
export async function parseSSE(
  res: Response,
  onText: (delta: string) => void
): Promise<{ text: string; toolCalls: ToolCall[]; finish: string | null }> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let finish: string | null = null;
  const calls = new Map<number, { id: string; name: string; args: string }>();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const json = JSON.parse(data);
        const choice = json.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta || {};
        if (typeof delta.content === "string" && delta.content) {
          text += delta.content;
          onText(delta.content);
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const cur = calls.get(idx) || { id: "", name: "", args: "" };
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name += tc.function.name;
            if (tc.function?.arguments) cur.args += tc.function.arguments;
            calls.set(idx, cur);
          }
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      } catch {
        // Ignore keep-alive comments / partial fragments.
      }
    }
  }

  const toolCalls: ToolCall[] = [...calls.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, c]) => ({
      id: c.id,
      type: "function" as const,
      function: { name: c.name, arguments: c.args },
    }))
    .filter((c) => c.function.name);

  return { text, toolCalls, finish };
}
