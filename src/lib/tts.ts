import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

export const TTS_VOICE =
  process.env.TTS_VOICE || "en-US-AndrewMultilingualNeural";

const TIMEOUT_MS = 30_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(label)), ms)
    ),
  ]);
}

/** Synthesize speech via Microsoft Edge's free TTS. Returns a full MP3 buffer. */
export async function synthesize(text: string): Promise<Buffer> {
  const tts = new MsEdgeTTS();
  try {
    return await withTimeout(
      (async () => {
        await tts.setMetadata(
          TTS_VOICE,
          OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3
        );
        const { audioStream } = tts.toStream(text);
        const chunks: Buffer[] = [];
        for await (const chunk of audioStream) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        return Buffer.concat(chunks);
      })(),
      TIMEOUT_MS,
      "Edge TTS timed out (no response from Microsoft)"
    );
  } finally {
    tts.close();
  }
}
