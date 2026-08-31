import { NextResponse } from "next/server";
import { signInWithPassword } from "../../../lib/auth";
import { appRedirectPath } from "../../../lib/paths";

export async function POST(request: Request) {
  const form = await request.formData();
  try {
    await signInWithPassword({
      email: String(form.get("email") || ""),
      password: String(form.get("password") || ""),
      displayName: String(form.get("displayName") || ""),
    });
    return NextResponse.redirect(appRedirectPath(request, "/"), 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to sign in";
    return NextResponse.redirect(appRedirectPath(request, `/login?error=${encodeURIComponent(message)}`), 303);
  }
}
