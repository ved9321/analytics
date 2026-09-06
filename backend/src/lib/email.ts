import { env } from '../env';

export interface EmailAttachment {
  filename: string;
  /** Base64-encoded file content. */
  content: string;
}

// Optional: if RESEND_API_KEY isn't set, callers get { sent: false } and
// fall back to showing a link or an on-demand download instead. Resend's
// free tier (100 emails/day) covers invite and report volume for any
// self-hosted deployment at this scale, but nothing here requires the
// account to exist — every feature that sends email has a no-email path.
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  attachments?: EmailAttachment[]
): Promise<{ sent: boolean; error?: string }> {
  if (!env.RESEND_API_KEY) return { sent: false };

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to,
        subject,
        html,
        ...(attachments?.length ? { attachments } : {}),
      }),
    });
    if (!res.ok) return { sent: false, error: await res.text() };
    return { sent: true };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : 'Unknown email error' };
  }
}
