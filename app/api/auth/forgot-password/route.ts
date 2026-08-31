import { NextResponse } from "next/server";
import { deliverPasswordReset } from "../../../lib/auth";
import { appRedirectPath, getPublicAppUrl } from "../../../lib/paths";

export async function POST(request: Request) {
  const form = await request.formData();
  const origin = getPublicAppUrl(new URL(request.url).origin, request);
  try {
    await deliverPasswordReset(String(form.get("email") || ""), origin);
    return NextResponse.redirect(appRedirectPath(request, "/login/forgot?sent=1"), 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send password reset email";
    return NextResponse.redirect(appRedirectPath(request, `/login/forgot?error=${encodeURIComponent(message)}`), 303);
  }
}
