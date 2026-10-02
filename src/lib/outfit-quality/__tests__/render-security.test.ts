// VAL-SEC-003: Cloudinary secrets are environment-managed and never leak into
// source, errors, or browser payloads; Higgsfield stays local-CLI only; the
// Quality Lab drain runs only where the local renderer exists.

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

// The modules this feature ships — none may ever contain a credential value.
const FEATURE_SOURCES = [
  'src/lib/outfit-quality/render-worker.ts',
  'src/lib/outfit-quality/render-domain.ts',
  'src/lib/outfit-quality/fidelity.ts',
  'src/lib/outfit-quality/promotion.ts',
  'src/lib/outfit-quality/gallery.ts',
  // Composition-only release: the gallery-actions.gated boundary fails closed and
  // the Accepted Images component has been removed from the tree.
  'src/app/admin/private-stylist/quality/gallery-actions.gated.ts',
]

function loadEnvLocal(): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    const text = readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf8')
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    /* no env file — value-scan tests skip themselves */
  }
  return out
}

describe('secrets are environment-managed (VAL-SEC-003)', () => {
  it('no feature source file contains a configured Cloudinary/Supabase/Anthropic secret VALUE', () => {
    const env = loadEnvLocal()
    const secretVars = ['CLOUDINARY_API_SECRET', 'CLOUDINARY_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'ANTHROPIC_API_KEY']
    const present = secretVars.map((v) => env[v]).filter((v) => v && v.length > 8)
    if (present.length === 0) return // env absent — nothing to scan against
    for (const file of FEATURE_SOURCES) {
      const text = readFileSync(path.resolve(process.cwd(), file), 'utf8')
      for (const value of present) {
        expect(text, `${file} must not contain a credential value`).not.toContain(value)
      }
      // The Cloudinary cloud NAME is read from env too — no host literal with an embedded name.
      expect(text).not.toMatch(/res\.cloudinary\.com\/(?!x\b)[a-z0-9-]+\//i)
    }
  })

  it('cloudinary config fails closed naming only the missing VARIABLES, never a value', async () => {
    // Deliberate non-secret canary: proves error text never echoes a configured value.
    const canary = 'canary-value-not-a-credential'
    const prev = { key: process.env.CLOUDINARY_API_KEY, secret: process.env.CLOUDINARY_API_SECRET }
    process.env.CLOUDINARY_API_KEY = canary
    delete process.env.CLOUDINARY_API_SECRET
    try {
      const { getCloudinaryConfig, cloudinaryConfigured, missingCloudinaryVars } = await import('@/lib/cloudinary-config')
      expect(cloudinaryConfigured()).toBe(false)
      expect(missingCloudinaryVars()).toContain('CLOUDINARY_API_SECRET')
      let message = ''
      try {
        getCloudinaryConfig()
      } catch (e) {
        message = e instanceof Error ? e.message : String(e)
      }
      expect(message).toContain('CLOUDINARY_API_SECRET')
      expect(message).not.toContain(canary)
    } finally {
      if (prev.key === undefined) delete process.env.CLOUDINARY_API_KEY
      else process.env.CLOUDINARY_API_KEY = prev.key
      if (prev.secret === undefined) delete process.env.CLOUDINARY_API_SECRET
      else process.env.CLOUDINARY_API_SECRET = prev.secret
    }
  })

  it('the real render adapters exist only for the local CLI environment and the drainer refuses without it', async () => {
    const { realQualityRenderAdapters, drainQualityRenderQueue } = await import('@/lib/outfit-quality/render-worker')
    const adapters = realQualityRenderAdapters()
    // Locally the CLI binary exists (mission precondition); the point under
    // test is the GATE: when it reports false, the queue is left untouched.
    expect(typeof adapters.rendererAvailable()).toBe('boolean')
    const gated = { ...adapters, rendererAvailable: () => false }
    const fakeDb = { from: () => { throw new Error('database must not be touched without a renderer') } }
    const r = await drainQualityRenderQueue(fakeDb as any, { workerId: 'sec-test', adapters: gated })
    expect(r.claimed).toBe(0)
    expect(r.skipped).toContain('no Higgsfield renderer')
  })

  it('the local Higgsfield CLI auth precondition holds on this machine', () => {
    // Documented mission precondition; if this fails, validation must stop
    // rather than spend the one real render.
    expect(existsSync(path.resolve(process.cwd(), 'node_modules/.bin/higgsfield'))).toBe(true)
  })

  it('browser payloads carry no server credential field names from the gallery read model', async () => {
    // AcceptedImageCard must not carry env, credentials, or private member data.
    const { loadAcceptedImages } = await import('@/lib/outfit-quality/gallery')
    expect(typeof loadAcceptedImages).toBe('function')
    const source = readFileSync(path.resolve(process.cwd(), 'src/lib/outfit-quality/gallery.ts'), 'utf8')
    expect(source).not.toContain('process.env.CLOUDINARY')
    expect(source).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
  })
})
