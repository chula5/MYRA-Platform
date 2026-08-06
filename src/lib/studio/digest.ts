// "MYRA review —" digest. A doorbell, not a door: a 3-outfit preview grid and
// ONE deep link to /studio/review — no approve/reject actions inside the
// email. Sent twice daily by cron; suppressed when the queue is empty; the
// email_log ledger hard-caps it at 2 per day.

import 'server-only'
import { loadReviewQueue } from './review-queue'
import { renderQueueStats } from './render-queue'
import { sendStudioEmail, emailShell, emailButton, thumbCell, countEmailsToday, siteUrl } from './email'

export async function sendReviewDigest(): Promise<{ sent: boolean; reason?: string }> {
  if ((await countEmailsToday('review_digest')) >= 2) {
    return { sent: false, reason: 'daily cap reached' }
  }

  const queue = await loadReviewQueue()
  const { pending: renderingNow, failedOutfits } = await renderQueueStats()

  // Doorbell only rings when there's something at the door.
  if (queue.length === 0 && failedOutfits.length === 0) {
    return { sent: false, reason: 'queue empty' }
  }

  const fastCount = queue.filter((c) => c.lane === 'fast' && c.kind === 'review').length
  const restockCount = queue.filter((c) => c.kind === 'restock').length

  const preview = queue.slice(0, 3)
  const grid = preview.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:14px 0;"><tr>
        ${preview.map((c) => thumbCell(c.composedGroupUrl, 150)).join('')}
      </tr><tr>
        ${preview.map((c) => `<td style="padding:2px 4px;font-size:10px;color:#a8a8a4;letter-spacing:0.05em;text-transform:uppercase;">${c.kind === 'restock' ? '⟳ RESTOCK · ' : ''}${escapeHtml(c.label).slice(0, 26)}</td>`).join('')}
      </tr></table>`
    : ''

  const failedBlock = failedOutfits.length
    ? `<p style="margin:14px 0 0 0;font-size:11px;color:#b83a3a;">render failed: ${failedOutfits.map((f) => escapeHtml(f.label)).join(' · ')} — open the studio to retry</p>`
    : ''

  const body = `
    <p style="margin:0 0 6px 0;font-size:14px;"><strong>${queue.length} outfit${queue.length === 1 ? '' : 's'} waiting</strong>${fastCount ? ` — ${fastCount} fast-lane` : ''}${restockCount ? ` · ${restockCount} restock` : ''}</p>
    <p style="margin:0;font-size:11px;color:#a8a8a4;">rendering now: ${renderingNow}</p>
    ${grid}
    ${failedBlock}
    <p style="margin:22px 0 0 0;">${emailButton(siteUrl('/studio/review'), 'Open the review queue')}</p>`

  const subject = `MYRA review — ${queue.length} outfit${queue.length === 1 ? '' : 's'} waiting (${fastCount} fast-lane)`
  return sendStudioEmail({
    kind: 'review_digest',
    subject,
    html: emailShell('REVIEW QUEUE', body),
    meta: { queue: queue.length, fast: fastCount, restock: restockCount, rendering: renderingNow },
  })
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
