/**
 * Canva Connect API client.
 *
 * Handles:
 *  - OAuth token exchange + refresh (tokens stored in Supabase `integration_credentials`)
 *  - Creating an autofill job against a Brand Template
 *  - Polling autofill job status
 *  - Uploading assets so the job can reference them
 */

import { createAdminClient } from '@/lib/supabase-server'

const CANVA_API = 'https://api.canva.com/rest/v1'
const PROVIDER = 'canva'

// ── env ───────────────────────────────────────────────────────
export const CANVA_CLIENT_ID = process.env.CANVA_CLIENT_ID ?? ''
export const CANVA_CLIENT_SECRET = process.env.CANVA_CLIENT_SECRET ?? ''
export const CANVA_REDIRECT_URI = process.env.CANVA_REDIRECT_URI ?? ''
export const CANVA_BRAND_TEMPLATE_ID = process.env.CANVA_BRAND_TEMPLATE_ID ?? ''

export const CANVA_SCOPES = [
  'design:content:read',
  'design:content:write',
  'design:meta:read',
  'asset:read',
  'asset:write',
  'brandtemplate:meta:read',
  'brandtemplate:content:read',
].join(' ')

// ── Token storage (Supabase) ──────────────────────────────────
interface StoredCreds {
  access_token: string
  refresh_token: string
  expires_at: string // timestamptz ISO
  scope: string | null
}

async function loadCreds(): Promise<StoredCreds | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('integration_credentials' as any)
    .select('access_token, refresh_token, expires_at, scope')
    .eq('provider', PROVIDER)
    .maybeSingle()
  return (data as any) ?? null
}

async function saveCreds(creds: {
  access_token: string
  refresh_token: string
  expires_in: number
  scope?: string
}) {
  const supabase = createAdminClient()
  const expiresAt = new Date(Date.now() + (creds.expires_in - 60) * 1000).toISOString()
  const { error } = await supabase
    .from('integration_credentials' as any)
    .upsert(
      {
        provider: PROVIDER,
        access_token: creds.access_token,
        refresh_token: creds.refresh_token,
        expires_at: expiresAt,
        scope: creds.scope ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'provider' }
    )
  if (error) throw error
}

// ── OAuth ─────────────────────────────────────────────────────
export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CANVA_CLIENT_ID,
    redirect_uri: CANVA_REDIRECT_URI,
    scope: CANVA_SCOPES,
    state,
    code_challenge_method: 'S256',
    // code_challenge will be added by caller if using PKCE
  })
  return `https://www.canva.com/api/oauth/authorize?${params.toString()}`
}

export async function exchangeCodeForTokens(code: string, codeVerifier: string) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
    redirect_uri: CANVA_REDIRECT_URI,
  })

  const res = await fetch(`${CANVA_API}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization:
        'Basic ' +
        Buffer.from(`${CANVA_CLIENT_ID}:${CANVA_CLIENT_SECRET}`).toString('base64'),
    },
    body: body.toString(),
  })

  const data = await res.json()
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${JSON.stringify(data)}`)
  }

  await saveCreds({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    scope: data.scope,
  })

  return data
}

async function refreshAccessToken(refreshToken: string): Promise<StoredCreds> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })

  const res = await fetch(`${CANVA_API}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization:
        'Basic ' +
        Buffer.from(`${CANVA_CLIENT_ID}:${CANVA_CLIENT_SECRET}`).toString('base64'),
    },
    body: body.toString(),
  })

  const data = await res.json()
  if (!res.ok) {
    throw new Error(`Token refresh failed: ${JSON.stringify(data)}`)
  }

  await saveCreds({
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? refreshToken,
    expires_in: data.expires_in,
    scope: data.scope,
  })

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? refreshToken,
    expires_at: new Date(Date.now() + (data.expires_in - 60) * 1000).toISOString(),
    scope: data.scope ?? null,
  }
}

export async function getAccessToken(): Promise<string> {
  let creds = await loadCreds()
  if (!creds) {
    throw new Error('Canva not connected. Visit /admin/canva to authorise.')
  }
  const expiresAt = new Date(creds.expires_at).getTime()
  if (Date.now() >= expiresAt) {
    creds = await refreshAccessToken(creds.refresh_token)
  }
  return creds.access_token
}

export async function isConnected(): Promise<boolean> {
  const creds = await loadCreds()
  return !!creds
}

// ── API calls ─────────────────────────────────────────────────
async function apiFetch(path: string, init: RequestInit = {}) {
  const token = await getAccessToken()
  const res = await fetch(`${CANVA_API}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Canva API ${res.status} ${path}: ${errText}`)
  }
  return res.json()
}

/**
 * Upload an asset from a public URL into the user's Canva library.
 * Returns the asset ID which can be referenced in autofill jobs.
 * Uses Canva's Async URL asset upload endpoint.
 */
export async function uploadAssetFromUrl(
  url: string,
  name: string
): Promise<string> {
  const create = await apiFetch('/url-asset-uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, name }),
  })
  let job = create.job
  while (job.status === 'in_progress') {
    await new Promise((r) => setTimeout(r, 1500))
    const poll = await apiFetch(`/url-asset-uploads/${job.id}`)
    job = poll.job
  }
  if (job.status === 'failed') {
    throw new Error(`Asset upload failed: ${job.error?.message ?? 'unknown'}`)
  }
  return job.asset.id as string
}

/**
 * Start an autofill job on a Brand Template.
 * Returns the Canva job ID (poll it to get the completed design).
 */
export async function startAutofill(
  brandTemplateId: string,
  title: string,
  data: Record<
    string,
    | { type: 'text'; text: string }
    | { type: 'image'; asset_id: string }
  >
): Promise<string> {
  const res = await apiFetch('/autofills', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      brand_template_id: brandTemplateId,
      title,
      data,
    }),
  })
  return res.job.id as string
}

/**
 * Poll an autofill job once. Returns the full job payload.
 * Check `.job.status` for 'in_progress' | 'success' | 'failed'.
 */
export async function getAutofillJob(jobId: string) {
  return apiFetch(`/autofills/${jobId}`)
}
