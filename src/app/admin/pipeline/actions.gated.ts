'use server'

// The browser-callable surface of ./actions.ts — admin only. Every export here
// checks the admin before doing anything. Server code that runs without an
// admin session (cron, lib, /me actions) imports ./actions directly instead.

import { assertAdmin } from '@/lib/admin-audit'
import * as impl from './actions'

export async function fastLaneApprove(...args: Parameters<typeof impl.fastLaneApprove>): Promise<Awaited<ReturnType<typeof impl.fastLaneApprove>>> {
  await assertAdmin()
  return impl.fastLaneApprove(...args)
}

export async function fastLaneOverride(...args: Parameters<typeof impl.fastLaneOverride>): Promise<Awaited<ReturnType<typeof impl.fastLaneOverride>>> {
  await assertAdmin()
  return impl.fastLaneOverride(...args)
}

export async function pipelineReject(...args: Parameters<typeof impl.pipelineReject>): Promise<Awaited<ReturnType<typeof impl.pipelineReject>>> {
  await assertAdmin()
  return impl.pipelineReject(...args)
}

export async function runEjectionBackfill(...args: Parameters<typeof impl.runEjectionBackfill>): Promise<Awaited<ReturnType<typeof impl.runEjectionBackfill>>> {
  await assertAdmin()
  return impl.runEjectionBackfill(...args)
}

export async function runPipelineBatch(...args: Parameters<typeof impl.runPipelineBatch>): Promise<Awaited<ReturnType<typeof impl.runPipelineBatch>>> {
  await assertAdmin()
  return impl.runPipelineBatch(...args)
}

export async function standardApprove(...args: Parameters<typeof impl.standardApprove>): Promise<Awaited<ReturnType<typeof impl.standardApprove>>> {
  await assertAdmin()
  return impl.standardApprove(...args)
}
