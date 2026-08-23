// "MYRA stock —" email, sent after a sentinel cycle ONLY when something
// changed. Three sections: swapped-and-relisting (with UNDO links),
// needs-your-pick (candidates deep-linking into the swap sheet), and a
// one-line summary. Back-in-stock items get a one-tap restore link.

import 'server-only'
import { thumbUrl } from '@/lib/image-utils'
import { sendStudioEmail, emailShell, thumbCell, siteUrl } from './email'
import type { SentinelReport } from './stock-sentinel'

export function stockEmailNeeded(r: SentinelReport): boolean {
  return r.itemsDown.length > 0 || r.autoSwapped.length > 0 || r.needsPick.length > 0 ||
    r.backInStock.length > 0 || r.archived > 0 || r.deferred > 0 || r.uniqueSold.length > 0
}

export async function sendStockEmail(r: SentinelReport): Promise<void> {
  if (!stockEmailNeeded(r)) return

  const sections: string[] = []

  if (r.autoSwapped.length > 0) {
    const rows = r.autoSwapped.map((s) => `
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:10px 0;width:100%;">
        <tr>
          ${thumbCell(s.outItem.image ? thumbUrl(s.outItem.image, 128) : null, 84)}
          <td style="padding:4px 10px;font-size:16px;color:#a8a8a4;">→</td>
          ${thumbCell(s.inItem.image ? thumbUrl(s.inItem.image, 128) : null, 84)}
          <td style="padding:4px 12px;font-size:12px;color:#4a4e57;line-height:1.5;">
            <strong>${escapeHtml(s.outfitLabel)}</strong><br/>
            ${escapeHtml(s.outItem.name)} → ${escapeHtml(s.inItem.name)}<br/>
            <span style="color:#a8a8a4;">similarity ${(s.similarity * 100).toFixed(0)}% · re-render queued</span><br/>
            <a href="${siteUrl(`/api/studio/undo-swap?token=${s.undoToken}`)}" style="color:#b83a3a;font-size:11px;letter-spacing:0.05em;">UNDO THIS SWAP</a>
          </td>
        </tr>
      </table>`).join('')
    sections.push(`<h3 style="font-size:12px;letter-spacing:0.1em;color:#4a4e57;margin:22px 0 6px 0;">SWAPPED AND RELISTING</h3>${rows}`)
  }

  // One-of-ones lead the email: they are irreversible, and each one has already
  // retired looks and started rescues that you may want to look at.
  if (r.uniqueSold.length > 0) {
    const rows = r.uniqueSold.map((u) => `
      <div style="margin:10px 0;padding:12px;border:1px solid #e2e0db;border-radius:8px;">
        <p style="margin:0 0 4px 0;font-size:12px;"><strong>${escapeHtml(u.name)}</strong> — sold</p>
        <p style="margin:0;font-size:11px;color:#a8a8a4;">
          ${u.outfitsRetired} live look${u.outfitsRetired === 1 ? '' : 's'} retired ·
          ${u.rescuesCreated} saved look${u.rescuesCreated === 1 ? '' : 's'} being restyled
        </p>
      </div>`).join('')
    sections.push(`<h3 style="font-size:12px;letter-spacing:0.1em;color:#4a4e57;margin:22px 0 6px 0;">ONE OF ONE — SOLD</h3>${rows}
      <p style="margin:6px 0 0 0;font-size:11px;color:#a8a8a4;">
        <a href="${siteUrl('/admin/second-hand')}" style="color:#4a4e57;">Open the second-hand dashboard →</a>
      </p>`)
  }

  if (r.needsPick.length > 0) {
    const rows = r.needsPick.map((n) => {
      const cands = n.candidates.length
        ? n.candidates.map((c) =>
            `<a href="${siteUrl(`/studio/review?outfit=${n.outfitId}&swap=${n.deadItem.id}&pick=${c.id}`)}" style="color:#4a4e57;text-decoration:underline;">${escapeHtml(c.brand ? `${c.brand} — ${c.name}` : c.name)} (${(c.similarity * 100).toFixed(0)}%)</a>`,
          ).join('<br/>')
        : '<span style="color:#a8a8a4;">no eligible candidates — open the desktop studio</span>'
      return `
      <div style="margin:10px 0;padding:12px;border:1px solid #e2e0db;border-radius:8px;">
        <p style="margin:0 0 4px 0;font-size:12px;"><strong>${escapeHtml(n.outfitLabel)}</strong></p>
        <p style="margin:0 0 8px 0;font-size:11px;color:#b83a3a;">DOWN: ${escapeHtml(n.deadItem.name)}</p>
        <p style="margin:0;font-size:11px;line-height:1.8;">${cands}</p>
      </div>`
    }).join('')
    sections.push(`<h3 style="font-size:12px;letter-spacing:0.1em;color:#4a4e57;margin:22px 0 6px 0;">NEEDS YOUR PICK</h3>${rows}`)
  }

  if (r.backInStock.length > 0) {
    const rows = r.backInStock.map((b) => {
      const restore = b.restoreToken
        ? ` — <a href="${siteUrl(`/api/studio/restore?token=${b.restoreToken}`)}" style="color:#3a6b3a;">restore original?</a>`
        : ''
      return `<p style="margin:4px 0;font-size:12px;">↺ <strong>${escapeHtml(b.name)}</strong> is back in stock${restore}</p>`
    }).join('')
    sections.push(`<h3 style="font-size:12px;letter-spacing:0.1em;color:#4a4e57;margin:22px 0 6px 0;">BACK IN STOCK</h3>${rows}`)
  }

  const summary =
    `${r.itemsChecked} items checked · ${r.itemsDown.length} down · ` +
    `${r.outfitsPaused} outfits paused · ${r.autoSwapped.length} auto-recovered` +
    (r.archived ? ` · ${r.archived} archived (30d dead)` : '') +
    (r.uniqueSold.length ? ` · ${r.uniqueSold.length} one-of-one sold` : '') +
    (r.sizeAlerts ? ` · ${r.sizeAlerts} size alerts raised` : '') +
    (r.deferred ? ` · ${r.deferred} held back by the per-run pause cap (next run)` : '')
  sections.push(`<p style="margin:24px 0 0 0;padding-top:14px;border-top:1px solid #e2e0db;font-size:11px;color:#a8a8a4;letter-spacing:0.04em;">${summary}</p>`)

  const subjectBits: string[] = []
  if (r.itemsDown.length) subjectBits.push(`${r.itemsDown.length} down`)
  if (r.autoSwapped.length) subjectBits.push(`${r.autoSwapped.length} auto-swapped`)
  if (r.needsPick.length) subjectBits.push(`${r.needsPick.length} need your pick`)
  if (r.backInStock.length) subjectBits.push(`${r.backInStock.length} back in stock`)
  if (r.uniqueSold.length) subjectBits.unshift(`${r.uniqueSold.length} one-of-one sold`)
  const subject = `MYRA stock — ${subjectBits.join(', ') || 'housekeeping'}`

  await sendStudioEmail({
    kind: 'stock_report',
    subject,
    html: emailShell('STOCK SENTINEL', sections.join('')),
    meta: {
      checked: r.itemsChecked, down: r.itemsDown.length, paused: r.outfitsPaused,
      autoSwapped: r.autoSwapped.length, needsPick: r.needsPick.length,
      backInStock: r.backInStock.length, archived: r.archived,
      uniqueSold: r.uniqueSold.length, sizeAlerts: r.sizeAlerts,
    },
  })
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
