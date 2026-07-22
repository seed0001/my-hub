import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { synthesize, cleanForSpeech } from "@/lib/tts";

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
    if (audio.length === 0)
      return NextResponse.json({ error: "TTS produced no audio." }, { status: 502 });
    return new Response(new Uint8Array(audio), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audio.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("tts failed", err);
    return NextResponse.json({ error: "Speech synthesis failed." }, { status: 502 });
  }
}
