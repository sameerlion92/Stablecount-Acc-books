type PasswordResetEmail = {
  to: string;
  displayName: string;
  resetUrl: string;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] || char));
}

export async function sendPasswordResetEmail(input: PasswordResetEmail) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.MAIL_FROM?.trim() || "Stablecount Acc-books <onboarding@resend.dev>";
  const subject = "Reset your Stablecount Acc-books password";
  const greeting = input.displayName ? `Hi ${input.displayName},` : "Hi,";
  const text = `${greeting}\n\nWe received a request to reset the password for your Stablecount Acc-books account.\n\nChoose a new password using this link (valid for 1 hour):\n${input.resetUrl}\n\nIf you did not request this, you can ignore this email.\n\nStablecount Acc-books`;
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;line-height:1.6;color:#173744"><p>${escapeHtml(greeting)}</p><p>We received a request to reset the password for your Stablecount Acc-books account.</p><p><a href="${escapeHtml(input.resetUrl)}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#176f8f;color:#fff;text-decoration:none;font-weight:700">Choose a new password</a></p><p>Or copy this link into your browser:<br><span style="word-break:break-all">${escapeHtml(input.resetUrl)}</span></p><p>This link expires in 1 hour. If you did not request a reset, you can ignore this email.</p><p>Stablecount Acc-books</p></body></html>`;

  if (!apiKey) {
    if (process.env.NODE_ENV === "development") {
      console.info(`[password-reset] ${input.to}: ${input.resetUrl}`);
      return;
    }
    throw new Error("Password reset email is not configured. Set RESEND_API_KEY and MAIL_FROM.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject,
      html,
      text,
    }),
  });

  if (!response.ok) {
    throw new Error("Unable to send the password reset email. Try again in a few minutes.");
  }
}
