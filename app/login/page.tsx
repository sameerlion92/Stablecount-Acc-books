import { redirect } from "next/navigation";
import { getSessionIdentity, hasRegisteredUsers } from "../lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getSessionIdentity()) redirect("/");
  const registered = await hasRegisteredUsers();
  const { error } = await searchParams;
  return <main className="login-page">
    <section className="login-card">
      <img src="/stablecount-logo.png" alt="StableCount" />
      <p className="eyebrow">Stablecount Acc-books</p>
      <h1>{registered ? "Sign in to your workspace" : "Create the Super Admin"}</h1>
      <p>{registered ? "Use the email assigned to your Stablecount user seat." : "This first account receives full control and can create the remaining nine user seats."}</p>
      {error && <div className="login-error">{error}</div>}
      <form action="/api/auth/login" method="post">
        {!registered && <label>Full name<input name="displayName" autoComplete="name" required /></label>}
        <label>Email address<input name="email" type="email" autoComplete="email" required /></label>
        <label>Password<input name="password" type="password" minLength={10} autoComplete={registered ? "current-password" : "new-password"} required /></label>
        <button type="submit">{registered ? "Sign in" : "Create Super Admin"}</button>
      </form>
      <small>Passwords require at least 10 characters. Invited users set their password the first time they sign in.</small>
    </section>
  </main>;
}

