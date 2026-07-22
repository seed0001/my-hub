import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { synthesize } from "@/lib/tts";
import { cleanForSpeech } from "@/lib/speechText";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const text = cleanForSpeech(String(body.text || ""));
  if (!text)
    return NextResponse.json({ error: "Nothing to speak." }, { status: 400 });

  try {
    const audio = await synthesize(text);
    if (audio.length === 0) {
      return NextResponse.json(
        { error: "Edge TTS returned no audio (likely blocked from this server)." },
        { status: 502 }
      );
    }
    return new Response(new Uint8Array(audio), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audio.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("tts failed:", msg, err);
    return NextResponse.json({ error: `Edge TTS failed: ${msg}` }, { status: 502 });
  }
}
