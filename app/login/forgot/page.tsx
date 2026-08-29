import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionIdentity } from "../../lib/auth";

export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string }> }) {
  if (await getSessionIdentity()) redirect("/");
  const { error, sent } = await searchParams;
  return <main className="login-page">
    <section className="login-card">
    <div className="brand-card login-brand">
      <img src="/stablecount-logo.png" alt="StableCount" />
      <p className="brand-product">Acc-books</p>
    </div>
      <h1>Reset your password</h1>
      <p>Enter the email address linked to your user seat. If an account exists, we will email you a secure link to choose a new password.</p>
      {sent === "1" && <div className="login-success">If that email is linked to an active user seat, a password reset link has been sent. Check your inbox and spam folder. The link expires in 1 hour.</div>}
      {error && <div className="login-error">{error}</div>}
      <form action="/api/auth/forgot-password" method="post" className="login-form">
        <label>Email address<input name="email" type="email" autoComplete="email" required /></label>
        <button type="submit">Send reset link</button>
      </form>
      <p className="login-links"><Link href="/login">Back to sign in</Link></p>
    </section>
  </main>;
}
