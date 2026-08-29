import { NextResponse } from "next/server";
import { resetPasswordWithToken } from "../../../lib/auth";

export async function POST(request: Request) {
  const form = await request.formData();
  const password = String(form.get("password") || "");
  const confirmPassword = String(form.get("confirmPassword") || "");
  try {
    if (password !== confirmPassword) throw new Error("Passwords do not match");
    await resetPasswordWithToken({
      token: String(form.get("token") || ""),
      password,
    });
    return NextResponse.redirect(new URL("/login?reset=1", request.url), 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to reset password";
    const token = String(form.get("token") || "");
    return NextResponse.redirect(new URL(`/reset-password?token=${encodeURIComponent(token)}&error=${encodeURIComponent(message)}`, request.url), 303);
  }
}
