import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()]}))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const ai = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
const { data } = await sb.from('outfit').select('outfit_id, formality, time_of_day, outfit_item(slot, item(item_type, material_primary, colour_family, brand:brand_id(name)))')
console.log('re-tagging', data.length, 'outfits')
function buildPrompt(o){
  const items=(o.outfit_item??[]).filter(oi=>oi.item).map(oi=>{const it=oi.item;const c=it.colour_family?it.colour_family+' ':'';const m=it.material_primary?it.material_primary+' ':'';const t=(it.item_type??oi.slot??'').replace(/_/g,' ');const b=it.brand?.name?` by ${it.brand.name}`:'';return `- ${c}${m}${t}${b}`.replace(/\s+/g,' ').trim()})
  if(!items.length) return null
  return `You are a fashion stylist tagging an outfit with the real-world occasions and seasons someone would wear it for.

OUTFIT SCORES (1-5): formality ${o.formality??3} (1=casual,5=black tie); time of day ${o.time_of_day??3} (1=day,5=night)
ITEMS:
${items.join('\n')}

Return ONLY a JSON array of 3 to 6 short lowercase tags. PRIMARY OCCASIONS (use the EXACT phrase for each that genuinely fits, include as many as fit): "weekend away", "work meeting", "wedding guest", "date night", "city summer evening" (polished not-black-tie summer evening — dinner/drinks/gallery), "casual summer weekend" (relaxed light daytime summer). You MAY also add from: "summer","spring","autumn","winter","holiday","beach day","garden party","dinner","lunch","city break".
Rules: light summer fabrics + daytime → almost always include "casual summer weekend"; smarter summer-fabric evening → include "city summer evening"; wool/knit/heavy → autumn/winter. No vague tags like "casual"/"everyday". Only occasions it genuinely suits.
Return just the array.`
}
let done=0,failed=0
for(const o of data){
  const p=buildPrompt(o); if(!p){failed++;continue}
  try{
    const msg=await ai.messages.create({model:'claude-haiku-4-5-20251001',max_tokens:200,messages:[{role:'user',content:p}]})
    const raw=msg.content[0]?.type==='text'?msg.content[0].text:''
    const arr=raw.match(/\[[\s\S]*\]/)?.[0]
    const tags=arr?[...new Set(JSON.parse(arr).filter(t=>typeof t==='string').map(t=>t.trim().toLowerCase()).filter(Boolean))].slice(0,6):[]
    if(!tags.length){failed++;continue}
    const {error}=await sb.from('outfit').update({occasion_tags:tags}).eq('outfit_id',o.outfit_id)
    if(error){failed++;continue}
    done++
    if(done<=5||done%20===0) console.log(`  ${done}: ${tags.join(', ')}`)
  }catch(e){failed++;console.error('fail',e.message)}
}
// coverage of the two new occasions
const { data: after } = await sb.from('outfit').select('occasion_tags')
const cse=after.filter(o=>(o.occasion_tags??[]).includes('city summer evening')).length
const csw=after.filter(o=>(o.occasion_tags??[]).includes('casual summer weekend')).length
console.log(`DONE — tagged ${done}, failed ${failed} | 'city summer evening': ${cse} outfits, 'casual summer weekend': ${csw} outfits`)
