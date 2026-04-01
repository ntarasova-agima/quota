import { NextRequest, NextResponse } from "next/server";
import { sendSmtpMail } from "@/lib/server/smtp";

export async function POST(request: NextRequest) {
  const providedKey = request.headers.get("x-email-api-key");
  const expectedKey = process.env.EMAIL_API_KEY ?? "dev-email-key";

  if (providedKey !== expectedKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const to = Array.isArray(body?.to) ? body.to : [body?.to].filter(Boolean);
    const subject = typeof body?.subject === "string" ? body.subject : "";
    const html = typeof body?.html === "string" ? body.html : "";

    if (!to.length || !subject || !html) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    await sendSmtpMail({ to, subject, html });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "SMTP error" },
      { status: 500 },
    );
  }
}
