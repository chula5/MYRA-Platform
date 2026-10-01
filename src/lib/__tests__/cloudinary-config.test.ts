import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// Sentinel fakes — never the real credentials. Prove the module reads from
// environment configuration, fails closed when incomplete, and never leaks a
// value in its error.
const SENTINEL = {
  cloud: 'sentinel-cloud-name',
  key: 'sentinel-api-key-000',
  secret: 'sentinel-api-secret-SHOULD-NOT-LEAK',
}

const CLOUD_VARS = [
  'CLOUDINARY_CLOUD_NAME',
  'NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
]

let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = {}
  for (const v of CLOUD_VARS) {
    saved[v] = process.env[v]
    delete process.env[v]
  }
})

afterEach(() => {
  for (const v of CLOUD_VARS) {
    if (saved[v] === undefined) delete process.env[v]
    else process.env[v] = saved[v]
  }
})

const load = async () => await import('@/lib/cloudinary-config')

describe('cloudinary-config — server-only credential loading', () => {
  it('loads the full config from environment configuration', async () => {
    process.env.CLOUDINARY_CLOUD_NAME = SENTINEL.cloud
    process.env.CLOUDINARY_API_KEY = SENTINEL.key
    process.env.CLOUDINARY_API_SECRET = SENTINEL.secret
    const { getCloudinaryConfig, cloudinaryConfigured } = await load()
    expect(cloudinaryConfigured()).toBe(true)
    expect(getCloudinaryConfig()).toEqual({
      cloudName: SENTINEL.cloud,
      apiKey: SENTINEL.key,
      apiSecret: SENTINEL.secret,
    })
  })

  it('falls back to the public cloud name variable', async () => {
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = SENTINEL.cloud
    process.env.CLOUDINARY_API_KEY = SENTINEL.key
    process.env.CLOUDINARY_API_SECRET = SENTINEL.secret
    const { cloudinaryCloudName, cloudinaryConfigured } = await load()
    expect(cloudinaryCloudName()).toBe(SENTINEL.cloud)
    expect(cloudinaryConfigured()).toBe(true)
  })

  it('fails closed when the secret is missing and never leaks a value', async () => {
    process.env.CLOUDINARY_CLOUD_NAME = SENTINEL.cloud
    process.env.CLOUDINARY_API_KEY = SENTINEL.key
    // secret deliberately absent
    const { getCloudinaryConfig, cloudinaryConfigured, missingCloudinaryVars } = await load()
    expect(cloudinaryConfigured()).toBe(false)
    expect(missingCloudinaryVars()).toContain('CLOUDINARY_API_SECRET')
    let caught: Error | null = null
    try {
      getCloudinaryConfig()
    } catch (e) {
      caught = e as Error
    }
    expect(caught).toBeInstanceOf(Error)
    // The error names the missing variable but exposes no configured value.
    expect(caught!.message).toContain('CLOUDINARY_API_SECRET')
    expect(caught!.message).not.toContain(SENTINEL.cloud)
    expect(caught!.message).not.toContain(SENTINEL.key)
    expect(caught!.message).not.toContain(SENTINEL.secret)
  })

  it('reports every missing variable when nothing is configured', async () => {
    const { missingCloudinaryVars, cloudinaryConfigured } = await load()
    expect(cloudinaryConfigured()).toBe(false)
    expect(missingCloudinaryVars()).toEqual([
      'CLOUDINARY_CLOUD_NAME',
      'CLOUDINARY_API_KEY',
      'CLOUDINARY_API_SECRET',
    ])
  })
})
