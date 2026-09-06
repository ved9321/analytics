import { prisma, logger } from '../../infra';
import { env } from '../../env';
import { sendEmail } from '../../lib/email';
import { evaluateAlertRules, AlertEvaluation } from '../alerts/alert.service';

// Notification delivery with de-duplication (the thing that was missing
// before): an ongoing breach must not re-notify on every worker tick, but
// a NEW breach of the same rule must. The breachKey below encodes "which
// breach is this", so the unique constraint on
// (alertRuleId, breachKey, channel) does the de-duplication in the
// database rather than in fragile in-memory state.

/** Same rule + same day + same direction = the same breach. */
function breachKey(evaluation: AlertEvaluation): string {
  const day = new Date().toISOString().slice(0, 10);
  const direction = (evaluation.pctChange ?? 0) >= 0 ? 'up' : 'down';
  return `${day}:${direction}`;
}

function describe(evaluation: AlertEvaluation): string {
  const { rule, currentValue, previousValue, pctChange } = evaluation;
  const movement =
    pctChange === null
      ? `is now ${currentValue.toLocaleString()}`
      : `moved ${pctChange >= 0 ? 'up' : 'down'} ${Math.abs(pctChange).toFixed(1)}% (${previousValue.toLocaleString()} → ${currentValue.toLocaleString()})`;
  return `${rule.metricKey} ${movement} over the last ${rule.windowDays} days.`;
}

async function alreadySent(alertRuleId: string, key: string, channel: string) {
  const existing = await prisma.notificationDelivery.findUnique({
    where: { alertRuleId_breachKey_channel: { alertRuleId, breachKey: key, channel } },
  });
  return Boolean(existing);
}

async function recordSent(workspaceId: string, alertRuleId: string, key: string, channel: string, detail: unknown) {
  try {
    await prisma.notificationDelivery.create({
      data: { workspaceId, alertRuleId, breachKey: key, channel, detail: detail as never },
    });
  } catch {
    // Unique-constraint collision means a concurrent worker got there
    // first — which is exactly the outcome we want, so ignore it.
  }
}

async function postToSlack(webhookUrl: string, text: string) {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Slack webhook failed (${res.status})`);
}

/**
 * Evaluates a workspace's alert rules and delivers anything newly
 * breached. Returns what was sent, so the caller can log or surface it.
 */
export async function deliverAlerts(workspaceId: string) {
  const evaluations = await evaluateAlertRules(workspaceId);
  const breached = evaluations.filter((e) => e.breached);
  if (breached.length === 0) return { sent: [] as string[] };

  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { name: true, slackWebhookUrl: true },
  });

  // Everyone who can configure alerts is someone who should hear about them.
  const recipients = await prisma.membership.findMany({
    where: { workspaceId, role: { in: ['ADMIN', 'MANAGER', 'ANALYST'] } },
    include: { user: { select: { email: true } } },
  });

  const sent: string[] = [];

  for (const evaluation of breached) {
    const key = breachKey(evaluation);
    const summary = describe(evaluation);

    // --- Email ---
    if (env.RESEND_API_KEY && !(await alreadySent(evaluation.rule.id, key, 'email'))) {
      const html = `<p><strong>${workspace.name}</strong></p><p>${summary}</p><p><a href="${env.APP_URL}/dashboard">Open dashboard</a></p>`;
      let anyDelivered = false;
      for (const recipient of recipients) {
        const result = await sendEmail(recipient.user.email, `Prism alert: ${evaluation.rule.metricKey}`, html);
        if (result.sent) anyDelivered = true;
      }
      if (anyDelivered) {
        await recordSent(workspaceId, evaluation.rule.id, key, 'email', { summary });
        sent.push(`email:${evaluation.rule.metricKey}`);
      }
    }

    // --- Slack ---
    if (workspace.slackWebhookUrl && !(await alreadySent(evaluation.rule.id, key, 'slack'))) {
      try {
        await postToSlack(workspace.slackWebhookUrl, `*${workspace.name}* — ${summary}`);
        await recordSent(workspaceId, evaluation.rule.id, key, 'slack', { summary });
        sent.push(`slack:${evaluation.rule.metricKey}`);
      } catch (err) {
        logger.warn({ err, workspaceId }, 'Slack alert delivery failed');
      }
    }

    // --- In-app ---
    // Always recorded, so the bell in the UI has something to show even
    // with no email or Slack configured.
    if (!(await alreadySent(evaluation.rule.id, key, 'in_app'))) {
      await recordSent(workspaceId, evaluation.rule.id, key, 'in_app', { summary, ...evaluation });
      sent.push(`in_app:${evaluation.rule.metricKey}`);
    }
  }

  return { sent };
}

/** In-app notification feed for the UI. */
export async function listNotifications(workspaceId: string) {
  return prisma.notificationDelivery.findMany({
    where: { workspaceId, channel: 'in_app' },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}
