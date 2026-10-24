// TELLING HER — the in-app note and, where she said yes, her phone.
//
// One call for both, so a note and its push never disagree: the note lands in
// pilot_notification (the unread count in the app), then every phone she has
// allowed notifications on gets the same words. A member without the app, or
// who said no, still gets the note. Plain module — crons and server code call
// it; there is no browser route in.

import 'server-only'
import { apnsConfigured, sendPush, type ApnsEnvironment, type PushMessage } from './apns'

export type NoteKind = 'looks_ready' | 'note' | 'event_picks' | 'share' | 'new_in'

export interface PushReport {
  devices: number
  sent: number
  /** Why nothing went: no key on the server, no phone on record. */
  skipped?: 'not_configured' | 'no_device'
  errors?: string[]
}

/** Push to every phone she has allowed. Disables tokens Apple says are dead. */
export async function pushToMember(admin: any, memberId: string, msg: PushMessage): Promise<PushReport> {
  const { data } = await admin.from('push_device')
    .select('device_token, environment').eq('member_id', memberId).is('disabled_at', null)
  const devices = (data ?? []) as { device_token: string; environment: ApnsEnvironment }[]
  if (!devices.length) return { devices: 0, sent: 0, skipped: 'no_device' }
  if (!apnsConfigured()) return { devices: devices.length, sent: 0, skipped: 'not_configured' }

  let sent = 0
  const errors: string[] = []
  for (const d of devices) {
    let r
    try {
      r = await sendPush(d.device_token, msg, d.environment)
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
      continue
    }
    const now = new Date().toISOString()
    if (r.ok) {
      sent++
      await admin.from('push_device').update({ last_sent_at: now, environment: r.environment, last_error: null }).eq('device_token', d.device_token)
    } else {
      errors.push(`${r.status} ${r.reason ?? ''}`.trim())
      await admin.from('push_device').update({
        last_error: `${r.status} ${r.reason ?? ''}`.trim(),
        ...(r.gone ? { disabled_at: now } : {}),
      }).eq('device_token', d.device_token)
    }
  }
  return { devices: devices.length, sent, ...(errors.length ? { errors } : {}) }
}

/**
 * The note in the app, and the same words on her phone. `push.title` is the
 * bold line on the lock screen; the note body is the line under it.
 */
export async function notifyMember(
  admin: any,
  note: { memberId: string; kind: NoteKind; body: string; lookIds?: string[] },
  push?: { title?: string; url?: string; collapseId?: string } | false,
): Promise<{ noted: boolean; push?: PushReport }> {
  const { error } = await admin.from('pilot_notification').insert({
    member_id: note.memberId, kind: note.kind, body: note.body, look_ids: note.lookIds ?? [],
  })
  if (push === false) return { noted: !error }
  const report = await pushToMember(admin, note.memberId, {
    title: push?.title ?? 'MYRA',
    body: note.body,
    url: push?.url,
    collapseId: push?.collapseId,
  }).catch((err) => ({ devices: 0, sent: 0, errors: [err instanceof Error ? err.message : String(err)] }) as PushReport)
  return { noted: !error, push: report }
}
