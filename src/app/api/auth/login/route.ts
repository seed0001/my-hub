import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { createSessionToken, setSessionCookie } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required." },
        { status: 400 }
      );
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    // Same generic error whether the email exists or not.
    const invalid = NextResponse.json(
      { error: "Invalid email or password." },
      { status: 401 }
    );

    if (!user) return invalid;

    const ok = await bcrypt.compare(String(password), user.passwordHash);
    if (!ok) return invalid;

    const token = await createSessionToken({ userId: user.id, email: user.email });
    await setSessionCookie(token);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("login error", err);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
