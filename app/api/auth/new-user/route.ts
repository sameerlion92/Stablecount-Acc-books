import { NextResponse } from "next/server";
import { activateInvitedUser } from "../../../lib/auth";
import { appRedirectPath } from "../../../lib/paths";

export async function POST(request: Request) {
  const form = await request.formData();
  try {
    await activateInvitedUser({
      displayName: String(form.get("displayName") || ""),
      email: String(form.get("email") || ""),
      password: String(form.get("password") || ""),
      confirmPassword: String(form.get("confirmPassword") || ""),
    });
    return NextResponse.redirect(appRedirectPath(request, "/"), 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to complete new user sign-in";
    return NextResponse.redirect(appRedirectPath(request, `/login/new-user?error=${encodeURIComponent(message)}`), 303);
  }
}
