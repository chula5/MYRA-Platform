import { NextRequest } from 'next/server'
import { memberFromRequest } from '@/lib/mirror/auth'
import { mirrorJson, mirrorOptions } from '@/lib/mirror/cors'
import { saveForMember, unsaveForMember } from '@/lib/mirror/save'
import { productFrom } from '@/lib/mirror/product'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// POST { product } saves; DELETE { url } unsaves.
export async function OPTIONS() { return mirrorOptions() }

export async function POST(req: NextRequest) {
  const member = await memberFromRequest(req)
  if (!member) return mirrorJson({ error: 'not connected' }, { status: 401 })
  let b: any
  try { b = await req.json() } catch { return mirrorJson({ error: 'bad json' }, { status: 400 }) }
  const product = productFrom(b?.product)
  if (!product) return mirrorJson({ error: 'product.url and product.title required' }, { status: 400 })
  const res = await saveForMember(member, product)
  return mirrorJson(res, { status: res.error ? 400 : 200 })
}

export async function DELETE(req: NextRequest) {
  const member = await memberFromRequest(req)
  if (!member) return mirrorJson({ error: 'not connected' }, { status: 401 })
  let b: any
  try { b = await req.json() } catch { return mirrorJson({ error: 'bad json' }, { status: 400 }) }
  if (typeof b?.url !== 'string') return mirrorJson({ error: 'url required' }, { status: 400 })
  return mirrorJson(await unsaveForMember(member, b.url))
}
