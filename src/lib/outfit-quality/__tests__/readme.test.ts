// VAL-OPS-002 — the repository README documents approved Quality Lab setup,
// operation, and testing, with environment-variable NAMES only, the port-3100
// startup and port-3000 boundary, exact test-data safety rules, the approved
// validation commands, and no customer Style item or always-on worker scope.

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const README_PATH = path.resolve(process.cwd(), 'README.md')

function loadEnvLocal(): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    const text = readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf8')
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    /* env absent — value-scan skips itself */
  }
  return out
}

describe('README documents setup, operation, and testing (VAL-OPS-002)', () => {
  const readme = existsSync(README_PATH) ? readFileSync(README_PATH, 'utf8') : ''

  it('exists and names every prerequisite environment variable without values', () => {
    expect(readme.length).toBeGreaterThan(0)
    for (const name of [
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'ADMIN_USER_ID',
      'ANTHROPIC_API_KEY',
      'CLOUDINARY_CLOUD_NAME',
      'CLOUDINARY_API_KEY',
      'CLOUDINARY_API_SECRET',
    ]) {
      expect(readme, `README names ${name}`).toContain(name)
    }
    // No configured secret VALUE may appear in the README.
    const env = loadEnvLocal()
    for (const [key, value] of Object.entries(env)) {
      if (value && value.length > 8 && /KEY|SECRET|TOKEN/i.test(key)) {
        expect(readme, `README must not contain the value of ${key}`).not.toContain(value)
      }
    }
  })

  it('documents install, port-3100 startup, and the port-3000 boundary', () => {
    expect(readme).toContain('npm ci')
    expect(readme).toMatch(/npm start -- --port 3100/)
    expect(readme).toContain('3100')
    expect(readme).toMatch(/3000 is off-limits/i)
    // Port 3000 may only ever appear as the boundary, never as a run instruction.
    expect(readme).not.toMatch(/localhost:3000/)
    expect(readme).not.toMatch(/--port 3000/)
  })

  it('documents bounded manual batch and chunk operation with pause/resume', () => {
    expect(readme).toMatch(/1–150 candidates per batch/)
    expect(readme).toMatch(/25 candidates/)
    expect(readme).toMatch(/pause/i)
    expect(readme).toMatch(/resume/i)
    expect(readme).toMatch(/starts nothing automatically|never create or start work/i)
  })

  it('documents explicit local sequential render draining, approval gating, durable persistence, one retry, and fail-closed attention', () => {
    expect(readme).toMatch(/exact-version human `?Yes`?/)
    expect(readme).toMatch(/explicitly and locally/i)
    expect(readme).toContain('Cloudinary')
    expect(readme).toMatch(/one corrective retry/i)
    expect(readme).toMatch(/fails? closed/i)
    expect(readme).toContain('attention_required')
    expect(readme).toMatch(/Vercel never drains/i)
  })

  it('documents partition semantics, unique run IDs, exact ID manifests, and exact cleanup', () => {
    for (const p of ['training', 'validation', 'holdout', 'synthetic', 'test']) {
      expect(readme, `partition ${p}`).toContain(p)
    }
    expect(readme).toContain("data_partition='test'")
    expect(readme).toMatch(/unique `?run_id`?/i)
    expect(readme).toMatch(/exact manifest|exact IDs/i)
    expect(readme).toContain('oq_test_cleanup')
    expect(readme).toMatch(/444 legacy canonical outfits/)
  })

  it('documents the exact approved validation commands', () => {
    expect(readme).toContain('npm test')
    expect(readme).toContain('npm run check:types')
    expect(readme).toContain(
      'npx next lint --dir src/app/admin/private-stylist --dir src/app/admin/stylists --dir src/app/admin/ai --dir src/app/api --dir src/lib',
    )
    expect(readme).toContain('npm run build')
  })

  it('documents programme guidance as manual-only and learning scope boundaries', () => {
    expect(readme).toContain('100–150')
    expect(readme).toContain('350–500')
    expect(readme).toContain('1,000–1,500')
    expect(readme).toContain('5,000')
    expect(readme).toMatch(/guidance only/i)
    expect(readme).toMatch(/member taste/i)
  })

  it('adds no customer Style item, auto-publish, or always-on worker instructions', () => {
    // The only mentions allowed are explicit out-of-scope / negated statements.
    expect(readme).toMatch(/out of scope/i)
    expect(readme).not.toMatch(/auto-?publish/i)
    const lines = readme.split('\n')
    for (const line of lines.filter((l) => /always-on|style item|being styled/i.test(l))) {
      expect(line, `out-of-scope mention must be a negation: ${line}`).toMatch(/no |never|not |absent|out of scope|without/i)
    }
    expect(readme).not.toMatch(/being styled.*(how to|enable|turn on)/i)
  })
})
