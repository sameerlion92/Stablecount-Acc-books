import { NextResponse } from "next/server";
import { resetPasswordWithToken } from "../../../lib/auth";
import { appRedirectPath } from "../../../lib/paths";

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
    return NextResponse.redirect(appRedirectPath(request, "/login?reset=1"), 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to reset password";
    const token = String(form.get("token") || "");
    return NextResponse.redirect(appRedirectPath(request, `/reset-password?token=${encodeURIComponent(token)}&error=${encodeURIComponent(message)}`), 303);
  }
}
