// Merchant record helpers for the Shopify integration. The access token is
// stored encrypted (AES-256-GCM) and only ever decrypted in memory — never
// logged, never returned to a client component.

import { createAdminClient } from '@/lib/supabase-server'
import { encryptToken, decryptToken } from './crypto'

export interface ShopifyMerchant {
  merchant_id: string
  name: string
  shop_domain: string
  accessToken: string
  return_window_days: number
  tracking_param_template: string | null
}

// Attach an installed shop to a merchant row. Matches an existing merchant on
// shop_domain first (J'amemme is pre-linked by migration 0023, so the install
// binds to the SAME merchant her existing items already point at), otherwise
// creates one.
export async function upsertMerchantFromInstall(opts: {
  shopDomain: string
  accessToken: string
  scope: string
  shopName?: string | null
}): Promise<{ merchantId: string; isNew: boolean }> {
  const admin = createAdminClient()
  const encrypted = encryptToken(opts.accessToken)

  const { data: existing } = await admin
    .from('merchant' as any)
    .select('merchant_id')
    .eq('shop_domain', opts.shopDomain)
    .maybeSingle()

  const patch = {
    type: 'shopify',
    status: 'active',
    link_mode: 'redirect',
    shop_domain: opts.shopDomain,
    access_token_encrypted: encrypted,
    granted_scopes: opts.scope,
    installed_at: new Date().toISOString(),
    uninstalled_at: null,
  }

  if (existing) {
    const id = (existing as any).merchant_id
    await admin.from('merchant' as any).update(patch as any).eq('merchant_id', id)
    return { merchantId: id, isNew: false }
  }

  const { data: created, error } = await admin
    .from('merchant' as any)
    .insert({ ...patch, name: opts.shopName || opts.shopDomain.replace('.myshopify.com', '') } as any)
    .select('merchant_id')
    .single()
  if (error) throw error
  return { merchantId: (created as any).merchant_id, isNew: true }
}

// Load a connected merchant + decrypted token, by shop domain.
export async function getShopifyMerchant(shopDomain: string): Promise<ShopifyMerchant | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('merchant' as any)
    .select('merchant_id, name, shop_domain, access_token_encrypted, return_window_days, tracking_param_template, status')
    .eq('shop_domain', shopDomain)
    .maybeSingle()

  const row = data as any
  if (!row?.access_token_encrypted) return null
  try {
    return {
      merchant_id: row.merchant_id,
      name: row.name,
      shop_domain: row.shop_domain,
      accessToken: decryptToken(row.access_token_encrypted),
      return_window_days: row.return_window_days ?? 30,
      tracking_param_template: row.tracking_param_template ?? null,
    }
  } catch {
    // Key rotated or corrupt ciphertext — treat as not connected rather than throw.
    return null
  }
}

// app/uninstalled — stop serving their items, drop the token.
export async function markUninstalled(shopDomain: string): Promise<void> {
  const admin = createAdminClient()
  await admin
    .from('merchant' as any)
    .update({
      status: 'uninstalled',
      access_token_encrypted: null,
      uninstalled_at: new Date().toISOString(),
    } as any)
    .eq('shop_domain', shopDomain)
}
