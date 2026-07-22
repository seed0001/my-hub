import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

export const TTS_VOICE =
  process.env.TTS_VOICE || "en-US-AndrewMultilingualNeural";

const MAX_TTS_CHARS = 4_000;

/** Make markdown-ish assistant text pleasant to listen to. */
export function cleanForSpeech(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, " (code omitted) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1")
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, "") // checkboxes
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^[|].*[|]$/gm, "") // tables
    .replace(/^[-=_]{3,}$/gm, "")
    .replace(/https?:\/\/\S+/g, "a link")
    .replace(/✓|✦|★|⏰|🔔|›|▸/g, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TTS_CHARS);
}

/** Synthesize speech via Microsoft Edge's free TTS. Returns a full MP3 buffer. */
export async function synthesize(text: string): Promise<Buffer> {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(TTS_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  try {
    const { audioStream } = tts.toStream(text);
    const chunks: Buffer[] = [];
    for await (const chunk of audioStream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } finally {
    tts.close();
  }
}
