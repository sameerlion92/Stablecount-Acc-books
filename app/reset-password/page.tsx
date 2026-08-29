import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionIdentity } from "../lib/auth";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  if (await getSessionIdentity()) redirect("/");
  const { token, error } = await searchParams;
  if (!token) redirect("/login/forgot");
  return <main className="login-page">
    <section className="login-card">
    <div className="brand-card login-brand">
      <img src="/stablecount-logo.png" alt="StableCount" />
      <p className="brand-product">Acc-books</p>
    </div>
      <h1>Choose a new password</h1>
      <p>Use the secure link from your email to choose a new password. Reset links expire after one hour.</p>
      {error && <div className="login-error">{error}</div>}
      <form action="/api/auth/reset-password" method="post" className="login-form">
        <input type="hidden" name="token" value={token} />
        <label>New password<input name="password" type="password" minLength={10} autoComplete="new-password" required /></label>
        <label>Confirm password<input name="confirmPassword" type="password" minLength={10} autoComplete="new-password" required /></label>
        <button type="submit">Update password</button>
      </form>
      <p className="login-links"><Link href="/login">Back to sign in</Link></p>
    </section>
  </main>;
}
