import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionIdentity, hasRegisteredUsers } from "../../lib/auth";

export const dynamic = "force-dynamic";

export default async function NewUserLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getSessionIdentity()) redirect("/");
  const registered = await hasRegisteredUsers();
  if (!registered) redirect("/login");
  const { error } = await searchParams;
  return <main className="login-page">
    <section className="login-card">
      <div className="brand-card login-brand">
        <img src="/stablecount-logo.png" alt="StableCount" />
        <p className="brand-product">Acc-books</p>
      </div>
      <h1>New user sign in</h1>
      <p>Use the same full name and email your Super Admin assigned to you. This one-time setup creates your password.</p>
      {error && <div className="login-error">{error}</div>}
      <form action="/api/auth/new-user" method="post" className="login-form">
        <label>Full name<input name="displayName" autoComplete="name" required minLength={2} /></label>
        <label>Email address<input name="email" type="email" autoComplete="email" required /></label>
        <label>Create password<input name="password" type="password" minLength={10} autoComplete="new-password" required /></label>
        <label>Confirm password<input name="confirmPassword" type="password" minLength={10} autoComplete="new-password" required /></label>
        <button type="submit">Create account &amp; sign in</button>
      </form>
      <p className="login-links"><Link href="/login">Back to sign in</Link></p>
      <small>After this one-time setup, use the normal sign-in page with your email and password.</small>
    </section>
  </main>;
}
