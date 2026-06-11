import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()]}))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const ai = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
const PRIM=['weekend away','work meeting','wedding guest','date night','city summer evening','casual summer weekend']
const { data } = await sb.from('outfit').select('outfit_id, occasion_tags, formality, time_of_day, outfit_item(slot, item(item_type, material_primary, colour_family, brand:brand_id(name)))')
const todo = data.filter(o => !(o.occasion_tags??[]).some(t=>PRIM.includes(t)))
console.log('to finish:', todo.length)
function P(o){const items=(o.outfit_item??[]).filter(oi=>oi.item).map(oi=>{const it=oi.item;const c=it.colour_family?it.colour_family+' ':'';const m=it.material_primary?it.material_primary+' ':'';const t=(it.item_type??oi.slot??'').replace(/_/g,' ');const b=it.brand?.name?` by ${it.brand.name}`:'';return `- ${c}${m}${t}${b}`.replace(/\s+/g,' ').trim()});if(!items.length)return null;return `Fashion stylist: tag this outfit. formality ${o.formality??3}/5, time ${o.time_of_day??3}/5.
ITEMS:
${items.join('\n')}
Return ONLY a JSON array of 3-6 lowercase tags. PRIMARY (use exact phrase for each that fits, include as many as fit): "weekend away","work meeting","wedding guest","date night","city summer evening" (polished summer evening),"casual summer weekend" (relaxed light daytime summer). MAY add: "summer","spring","autumn","winter","holiday","beach day","garden party","dinner","lunch","city break". Light summer daytime→include "casual summer weekend"; smart summer evening→"city summer evening"; wool/knit/heavy→autumn/winter. Every outfit must get at least one PRIMARY. Return just the array.`}
let done=0,failed=0
for(const o of todo){const p=P(o);if(!p){failed++;continue}
 try{const msg=await ai.messages.create({model:'claude-haiku-4-5-20251001',max_tokens:200,messages:[{role:'user',content:p}]})
  const raw=msg.content[0]?.type==='text'?msg.content[0].text:'';const arr=raw.match(/\[[\s\S]*\]/)?.[0]
  const tags=arr?[...new Set(JSON.parse(arr).filter(t=>typeof t==='string').map(t=>t.trim().toLowerCase()).filter(Boolean))].slice(0,6):[]
  if(!tags.length){failed++;continue}
  const {error}=await sb.from('outfit').update({occasion_tags:tags}).eq('outfit_id',o.outfit_id)
  if(error){failed++;continue};done++
 }catch(e){failed++}}
const { data: after } = await sb.from('outfit').select('occasion_tags')
const noPrim=after.filter(o=>!(o.occasion_tags??[]).some(t=>PRIM.includes(t))).length
console.log(`DONE — tagged ${done}, failed ${failed}, still-no-primary ${noPrim}`)
