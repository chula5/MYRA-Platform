import 'server-only'
import { sendStudioEmail, siteUrl, memberEmailShell, emailButton } from './email'
import { greetingName } from './black-friday-email'

// LIGHT READING — highlights from Carmen's piece in The Data Fashion Brief
// ("I'm A Fashion Data Analyst, But Still Can't Get Dressed"), with a button
// to the full article on MYRA (/press/the-data-fashion-brief-cant-get-dressed).
// Sent as MYRA, replies to Chloe, in the member email look.

const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const DATA_BRIEF_SUBJECT = 'Light reading: the fashion data analyst who still can’t get dressed'
export const DATA_BRIEF_PATH = '/press/the-data-fashion-brief-cant-get-dressed'

const FONT = 'font-family:Helvetica,Arial,sans-serif;'
const p = (t: string) => `<p style="margin:0 0 16px 0;${FONT}font-size:15px;line-height:1.6;color:#2b2b2b;">${t}</p>`
const h = (t: string) => `<p style="margin:28px 0 8px 0;${FONT}font-size:13px;letter-spacing:0.12em;line-height:1.4;color:#2b2b2b;text-transform:uppercase;">${t}</p>`
const b = (t: string) => `<strong style="color:#0a0a0a;">${t}</strong>`
const quote = (t: string) => `<p style="margin:8px 0 20px 0;padding:0 0 0 16px;border-left:2px solid #0a0a0a;${FONT}font-size:17px;line-height:1.5;color:#0a0a0a;font-style:italic;">${t}</p>`
const img = (src: string, alt: string, caption?: string) =>
  `<img src="${siteUrl(src)}" width="496" alt="${esc(alt)}" style="display:block;width:100%;max-width:496px;height:auto;border-radius:10px;margin:4px 0 ${caption ? '6px' : '20px'} 0;border:0;" />` +
  (caption ? `<p style="margin:0 0 20px 0;${FONT}font-size:11px;line-height:1.5;color:#a8a8a4;">${caption}</p>` : '')

export function dataBriefEmailHtml(name: string): string {
  const first = greetingName(name)
  const article = siteUrl(DATA_BRIEF_PATH)
  const body = `
${p(first ? `Hello ${esc(first)},` : 'Hello,')}
${p(`Something to read with your coffee. Carmen writes ${b('The Data Fashion Brief')}, where she reads fashion through the numbers: what people search for, what&rsquo;s on the catwalk, and what we end up wearing. Her latest piece starts with a confession.`)}
${quote('I&rsquo;m a fashion data analyst, but I still can&rsquo;t get dressed.')}

${h('Too many tabs, not enough decisions')}
${p('With Milan Fashion Week and a wedding back to back, Carmen had a dozen tabs open across three retailers, a basket she knew she&rsquo;d never buy, and hours spent comparing the same five options. She calls it shopping paralysis.')}
${p(`She isn&rsquo;t alone. Google searches for &ldquo;shopping assistant&rdquo; and &ldquo;style assistant&rdquo; sat flat for four years, then broke out in June 2025, peaking this May at ${b('+4,900%')}.`)}
${img('/press/tdfb-search-interest-chart.jpg', 'Search interest in shopping and style assistants, 2021 to 2026', 'Shopping assistant &amp; style assistant search interest, June 2021 to June 2026. Source: Google Trends.')}

${h('The jam study')}
${p(`Her favourite piece of evidence: a famous experiment where a table of ${b('24 jams')} drew more shoppers than a table of six, but only ${b('3%')} of them bought, against ${b('30%')} at the smaller table. Past a point, more choice means we choose nothing at all.`)}

${h('One decision instead of forty')}
${p(`Carmen tried MYRA ahead of launch. She told it what she was dressing for, and for the wedding it came back with the ${b('16Arlington Flora skirt')}: blush chiffon with a feathered hem, styled with a lace-trim cami, patent sandals and a beaded bag.`)}
${img('/press/16arlington-flora-skirt-looks.jpg', 'The 16Arlington Flora skirt, styled for a wedding')}
${p('She explains why it was no accident: romance is trending, with searches up 170% since late 2025, as a reaction to an automated world.')}
${quote('Less &ldquo;here&rsquo;s a thousand options, good luck&rdquo;, more &ldquo;here&rsquo;s the answer to the question you actually asked.&rdquo;')}

<p style="margin:24px 0 8px 0;">${emailButton(article, 'Read the full article')}</p>
<p style="margin:0 0 0 0;${FONT}font-size:12px;color:#7c838b;">About a five-minute read, with Carmen&rsquo;s charts and both looks.</p>`

  return memberEmailShell('LIGHT READING · THE DATA FASHION BRIEF', body, DATA_BRIEF_SUBJECT)
}

export async function sendDataBriefEmail(to: string, name: string, meta: Record<string, unknown> = {}) {
  return sendStudioEmail({
    kind: 'shopper_light_reading', to, subject: DATA_BRIEF_SUBJECT,
    html: dataBriefEmailHtml(name), meta: { to, name, ...meta },
  })
}
