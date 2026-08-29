import { NextResponse } from "next/server";
import { deliverPasswordReset } from "../../../lib/auth";

export async function POST(request: Request) {
  const form = await request.formData();
  const origin = new URL(request.url).origin;
  try {
    await deliverPasswordReset(String(form.get("email") || ""), origin);
    return NextResponse.redirect(new URL("/login/forgot?sent=1", request.url), 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send password reset email";
    return NextResponse.redirect(new URL(`/login/forgot?error=${encodeURIComponent(message)}`, request.url), 303);
  }
}
