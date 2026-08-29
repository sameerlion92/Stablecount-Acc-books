import { NextResponse } from "next/server";
import { signInWithPassword } from "../../../lib/auth";

export async function POST(request: Request) {
  const form = await request.formData();
  try {
    await signInWithPassword({
      email: String(form.get("email") || ""),
      password: String(form.get("password") || ""),
      displayName: String(form.get("displayName") || ""),
    });
    return NextResponse.redirect(new URL("/", request.url), 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to sign in";
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, request.url), 303);
  }
}

