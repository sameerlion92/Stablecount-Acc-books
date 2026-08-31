import { NextResponse } from "next/server";
import { signOut } from "../../../lib/auth";
import { appRedirectPath } from "../../../lib/paths";

export async function GET(request: Request) {
  await signOut();
  return NextResponse.redirect(appRedirectPath(request, "/login"), 303);
}

