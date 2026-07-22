import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

function faviconFor(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
  } catch {
    return null;
  }
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const bookmarks = await prisma.bookmark.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ bookmarks });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const rawUrl = String(body.url || "").trim();
  if (!rawUrl) return NextResponse.json({ error: "URL is required." }, { status: 400 });

  const url = normalizeUrl(rawUrl);
  const title = String(body.title || "").trim() || url.replace(/^https?:\/\//, "");

  const tags = Array.isArray(body.tags)
    ? body.tags.map((t: unknown) => String(t).trim()).filter(Boolean)
    : [];

  const bookmark = await prisma.bookmark.create({
    data: {
      userId: session.userId,
      url,
      title,
      note: body.note ? String(body.note) : null,
      category: body.category ? String(body.category).trim() : null,
      tags,
      favicon: faviconFor(url),
    },
  });

  return NextResponse.json({ bookmark });
}
