type PasswordResetEmail = {
  to: string;
  displayName: string;
  resetUrl: string;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] || char));
}

function mailFrom() {
  return process.env.MAIL_FROM?.trim() || "Stablecount Acc-books <accounts@localhost>";
}

function buildPasswordResetContent(input: PasswordResetEmail) {
  const subject = "Reset your Stablecount Acc-books password";
  const greeting = input.displayName ? `Hi ${input.displayName},` : "Hi,";
  const text = `${greeting}\n\nWe received a request to reset the password for your Stablecount Acc-books account.\n\nChoose a new password using this link (valid for 1 hour):\n${input.resetUrl}\n\nIf you did not request this, you can ignore this email.\n\nStablecount Acc-books`;
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;line-height:1.6;color:#173744"><p>${escapeHtml(greeting)}</p><p>We received a request to reset the password for your Stablecount Acc-books account.</p><p><a href="${escapeHtml(input.resetUrl)}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#176f8f;color:#fff;text-decoration:none;font-weight:700">Choose a new password</a></p><p>Or copy this link into your browser:<br><span style="word-break:break-all">${escapeHtml(input.resetUrl)}</span></p><p>This link expires in 1 hour. If you did not request a reset, you can ignore this email.</p><p>Stablecount Acc-books</p></body></html>`;
  return { subject, text, html };
}

async function sendViaSmtp(input: PasswordResetEmail) {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return false;

  const nodemailer = await import("nodemailer");
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === "true" || port === 465;
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const { subject, text, html } = buildPasswordResetContent(input);

  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass: pass || "" } : undefined,
  });

  await transport.sendMail({
    from: mailFrom(),
    to: input.to,
    subject,
    text,
    html,
  });
  return true;
}

async function sendViaResend(input: PasswordResetEmail) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return false;

  const { subject, text, html } = buildPasswordResetContent(input);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: mailFrom(),
      to: [input.to],
      subject,
      html,
      text,
    }),
  });

  if (!response.ok) {
    throw new Error("Unable to send the password reset email. Try again in a few minutes.");
  }
  return true;
}

export async function sendPasswordResetEmail(input: PasswordResetEmail) {
  if (await sendViaSmtp(input)) return;
  if (await sendViaResend(input)) return;

  if (process.env.NODE_ENV === "development") {
    console.info(`[password-reset] ${input.to}: ${input.resetUrl}`);
    return;
  }

  throw new Error(
    "Password reset email is not configured. Set SMTP_HOST (personal server) or RESEND_API_KEY, plus MAIL_FROM.",
  );
}
