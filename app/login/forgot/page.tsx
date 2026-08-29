import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionIdentity } from "../../lib/auth";

export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string }> }) {
  if (await getSessionIdentity()) redirect("/");
  const { error, sent } = await searchParams;
  return <main className="login-page">
    <section className="login-card">
      <img src="/stablecount-logo.svg" alt="StableCount" className="login-logo" />
      <p className="eyebrow">Stablecount Acc-books</p>
      <h1>Reset your password</h1>
      <p>Enter the email address linked to your user seat. If the account exists, you can choose a new password on the next screen.</p>
      {sent === "1" && <div className="login-success">If that email has an active seat, continue from the reset screen or ask your Super Admin to clear your password.</div>}
      {error && <div className="login-error">{error}</div>}
      <form action="/api/auth/forgot-password" method="post" className="login-form">
        <label>Email address<input name="email" type="email" autoComplete="email" required /></label>
        <button type="submit">Continue</button>
      </form>
      <p className="login-links"><Link href="/login">Back to sign in</Link></p>
      <small>Accounts that have not finished first-time password setup must sign in once and choose a password before using reset.</small>
    </section>
  </main>;
}
