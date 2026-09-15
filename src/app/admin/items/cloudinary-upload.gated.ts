'use server'

// The browser-callable surface of ./cloudinary-upload.ts — admin only. Every export here
// checks the admin before doing anything. Server code that runs without an
// admin session (cron, lib, /me actions) imports ./cloudinary-upload directly instead.

import { assertAdmin } from '@/lib/admin-audit'
import * as impl from './cloudinary-upload'

export async function scrapeAndUploadToCloudinary(...args: Parameters<typeof impl.scrapeAndUploadToCloudinary>): Promise<Awaited<ReturnType<typeof impl.scrapeAndUploadToCloudinary>>> {
  await assertAdmin()
  return impl.scrapeAndUploadToCloudinary(...args)
}

export async function uploadBase64ToCloudinary(...args: Parameters<typeof impl.uploadBase64ToCloudinary>): Promise<Awaited<ReturnType<typeof impl.uploadBase64ToCloudinary>>> {
  await assertAdmin()
  return impl.uploadBase64ToCloudinary(...args)
}
