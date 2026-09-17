// IMAP — for inboxes with no sign-in for apps. Virgin Media Mail (which now
// runs @blueyonder.co.uk and @virginmedia.com addresses) allows outside apps
// over IMAP with a Virgin Media Mail APP PASSWORD — generated in My Virgin
// Media → Account details → Virgin Media Mail — not her main password. It opens
// mail only and she can revoke it there at any time. Server only.

import 'server-only'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import type { MailMessage } from './purchase-core'

export interface ImapConfig {
  host: string
  email: string
  password: string
}

export const IMAP_PRESETS: Record<string, { host: string; label: string; help: string }> = {
  virgin_media: {
    host: 'imap.virginmedia.com',
    label: 'Virgin Media / Blueyonder',
    help: 'https://www.virginmedia.com/help/broadband/manage-email-settings',
  },
}

/** Which preset an address belongs to, if any. */
export function presetForEmail(email: string): string | null {
  return /@(blueyonder\.co\.uk|virginmedia\.com|virgin\.net|ntlworld\.com)$/i.test(email.trim()) ? 'virgin_media' : null
}

async function withImap<T>(cfg: ImapConfig, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = new ImapFlow({
    host: cfg.host,
    port: 993,
    secure: true,
    auth: { user: cfg.email, pass: cfg.password },
    logger: false,
    socketTimeout: 60_000,
  })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.logout().catch(() => undefined)
  }
}

/** Can MYRA sign in with these details? A plain-English error if not. */
export async function testImapLogin(cfg: ImapConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    await withImap(cfg, async (c) => { await c.mailboxOpen('INBOX', { readOnly: true }) })
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/auth|login|credentials|password|AUTHENTICATIONFAILED/i.test(msg)) {
      return { ok: false, error: 'That email and app password did not work. Make sure it is the Virgin Media Mail APP password, not the My Virgin Media password.' }
    }
    return { ok: false, error: `Could not reach the mailbox: ${msg}` }
  }
}

/** Order- and return-looking messages in the inbox since a date, as uids (newest first). */
export async function listImapPurchaseUids(cfg: ImapConfig, since: Date, max = 1500): Promise<string[]> {
  return withImap(cfg, async (c) => {
    await c.mailboxOpen('INBOX', { readOnly: true })
    const words = ['order', 'receipt', 'confirmation', 'dispatched', 'shipped', 'on its way', 'return', 'refund', 'cancel']
    const found = new Set<number>()
    for (const w of words) {
      const uids = await c.search({ since, subject: w }, { uid: true })
      for (const u of uids || []) found.add(u)
    }
    return Array.from(found).sort((a, b) => b - a).slice(0, max).map(String)
  })
}

export async function fetchImapMessages(cfg: ImapConfig, uids: string[]): Promise<MailMessage[]> {
  if (!uids.length) return []
  return withImap(cfg, async (c) => {
    await c.mailboxOpen('INBOX', { readOnly: true })
    const out: MailMessage[] = []
    for await (const msg of c.fetch(uids.join(','), { source: true, uid: true }, { uid: true })) {
      if (!msg.source) continue
      const parsed = await simpleParser(msg.source)
      out.push({
        id: String(msg.uid),
        subject: parsed.subject ?? '',
        from: parsed.from?.text ?? '',
        date: parsed.date ? parsed.date.toISOString() : null,
        html: typeof parsed.html === 'string' ? parsed.html : null,
        text: parsed.text ?? null,
      })
    }
    return out
  })
}
