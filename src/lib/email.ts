/**
 * Thin wrapper around Resend's REST API — plain fetch, no SDK dependency, since this is the
 * only kind of email this app sends outside Supabase Auth's own invite/password-reset flow
 * (see inviteOrFindUser in src/lib/employees-admin.ts, which goes through Supabase instead).
 *
 * Requires RESEND_API_KEY in the environment. EMAIL_FROM defaults to Resend's own shared
 * sandbox sender, which only delivers to the email address on the Resend account itself —
 * real delivery to employees needs a verified sending domain and a real EMAIL_FROM address.
 * See README's "Clock-out reminders" section for the one-time setup this needs.
 */
export class EmailNotConfiguredError extends Error {
  constructor() {
    super("RESEND_API_KEY is not set — email sending is disabled.");
    this.name = "EmailNotConfiguredError";
  }
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new EmailNotConfiguredError();
  const from = process.env.EMAIL_FROM || "TTC HR Portal <onboarding@resend.dev>";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend API error (${res.status}): ${body}`);
  }
}
