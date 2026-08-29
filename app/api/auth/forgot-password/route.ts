import { NextResponse } from "next/server";
import { requestPasswordReset } from "../../../lib/auth";

export async function POST(request: Request) {
  const form = await request.formData();
  try {
    const token = await requestPasswordReset(String(form.get("email") || ""));
    if (!token) {
      return NextResponse.redirect(new URL("/login/forgot?sent=1", request.url), 303);
    }
    return NextResponse.redirect(new URL(`/reset-password?token=${encodeURIComponent(token)}`, request.url), 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start password reset";
    return NextResponse.redirect(new URL(`/login/forgot?error=${encodeURIComponent(message)}`, request.url), 303);
  }
}
