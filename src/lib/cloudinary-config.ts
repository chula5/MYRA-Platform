// Server-only Cloudinary credential loading.
//
// No credential literal lives in source. The cloud name, API key and API secret
// are read lazily from server-side environment configuration so they never
// enter a client bundle and never appear in a committed file. The key and
// secret are non-public (not NEXT_PUBLIC_*) and are only ever read inside the
// server functions that sign an upload.
//
// Fail-closed: a caller that needs to sign an upload asks for the full config
// and receives a redacted error naming the MISSING variable names — never any
// value — when configuration is incomplete.
//
// This module is server-only. Importing it from a Client Component is a build
// error, so the API key and secret can never be bundled for the browser.
import 'server-only'

export interface CloudinaryConfig {
  cloudName: string
  apiKey: string
  apiSecret: string
}

const CLOUD_NAME_VARS = ['CLOUDINARY_CLOUD_NAME', 'NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME'] as const

/** The public cloud name, read from env. Returns '' when unset. */
export function cloudinaryCloudName(): string {
  for (const name of CLOUD_NAME_VARS) {
    const v = process.env[name]
    if (v) return v
  }
  return ''
}

/** Which required variables are currently missing. Values are never returned. */
export function missingCloudinaryVars(): string[] {
  const missing: string[] = []
  if (!cloudinaryCloudName()) missing.push('CLOUDINARY_CLOUD_NAME')
  if (!process.env.CLOUDINARY_API_KEY) missing.push('CLOUDINARY_API_KEY')
  if (!process.env.CLOUDINARY_API_SECRET) missing.push('CLOUDINARY_API_SECRET')
  return missing
}

/** True when a signed upload can be performed. */
export function cloudinaryConfigured(): boolean {
  return missingCloudinaryVars().length === 0
}

/**
 * Resolve the full server-only Cloudinary configuration or fail closed with a
 * redacted error. The error names the missing variables only; it never echoes
 * a configured value.
 */
export function getCloudinaryConfig(): CloudinaryConfig {
  const missing = missingCloudinaryVars()
  if (missing.length > 0) {
    throw new Error(`Cloudinary is not configured — missing: ${missing.join(', ')}`)
  }
  return {
    cloudName: cloudinaryCloudName(),
    apiKey: process.env.CLOUDINARY_API_KEY as string,
    apiSecret: process.env.CLOUDINARY_API_SECRET as string,
  }
}
