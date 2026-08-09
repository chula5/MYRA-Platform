// Minimal Shopify GraphQL Admin API client. Pinned API version, hard timeout,
// bounded retry on transient failures (throttle / 5xx / network). No SDK — the
// surface we need is small and this keeps the behaviour explicit and testable.

export const SHOPIFY_API_VERSION = '2026-07'

const TIMEOUT_MS = 15_000
const MAX_ATTEMPTS = 3

export class ShopifyApiError extends Error {
  constructor(message: string, public status?: number, public errors?: unknown) {
    super(message)
    this.name = 'ShopifyApiError'
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function shopifyGraphql<T = any>(
  shopDomain: string,
  accessToken: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`
  let lastErr: unknown

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })

      // Throttled or transient server error → back off and retry.
      if (res.status === 429 || res.status >= 500) {
        lastErr = new ShopifyApiError(`Shopify ${res.status}`, res.status)
        if (attempt < MAX_ATTEMPTS) { await sleep(500 * 2 ** (attempt - 1)); continue }
        throw lastErr
      }
      if (!res.ok) {
        // 401/403 → token revoked or scope missing. Not retryable.
        throw new ShopifyApiError(`Shopify request failed (${res.status})`, res.status)
      }

      const json = await res.json()
      if (json.errors?.length) {
        const throttled = json.errors.some((e: any) => e?.extensions?.code === 'THROTTLED')
        if (throttled && attempt < MAX_ATTEMPTS) {
          lastErr = new ShopifyApiError('Shopify throttled', 429, json.errors)
          await sleep(1000 * attempt)
          continue
        }
        throw new ShopifyApiError('Shopify GraphQL errors', res.status, json.errors)
      }
      return json.data as T
    } catch (err) {
      if (err instanceof ShopifyApiError) throw err
      lastErr = err // network / timeout
      if (attempt < MAX_ATTEMPTS) { await sleep(500 * 2 ** (attempt - 1)); continue }
    }
  }
  throw lastErr instanceof Error ? lastErr : new ShopifyApiError('Shopify request failed after retries')
}

// ── OAuth token exchange ────────────────────────────────────────────────────
export async function exchangeCodeForToken(
  shopDomain: string,
  code: string,
): Promise<{ access_token: string; scope: string }> {
  const res = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      code,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new ShopifyApiError(`Token exchange failed (${res.status})`, res.status)
  return res.json()
}
