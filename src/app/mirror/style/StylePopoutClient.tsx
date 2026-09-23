'use client'

import { useEffect, useRef, useState } from 'react'
import FallbackImage from '@/components/FallbackImage'
import ShopLink from '@/components/ShopLink'

type Mode = 'wardrobe' | 'inspiration'
interface LookItem { item_id?: string | null; product_name: string; brand: string; image_url?: string | null; price_gbp?: number | null; url?: string; owned: boolean }
interface Look { items: LookItem[]; why: string }
interface Result { looks: Look[]; hidden?: number; error?: string; hero?: { item_id: string; product_name: string; image_url: string | null } }
interface Product { url: string; title: string; brand?: string | null; type?: string | null; price?: number | null; image?: string | null; available?: boolean | null; sizes?: { label: string; available: boolean }[] | null }
interface Take { confidence: number; line: string; owns?: { product_name: string; brand: string | null }[]; error?: string }
interface Me { name?: string; actingAdmin?: boolean }

const MODES: { id: Mode; label: string }[] = [
  { id: 'wardrobe', label: 'With my wardrobe' },
  { id: 'inspiration', label: 'Style inspiration' },
]

export default function StylePopoutClient({ productUrl }: { productUrl: string }) {
  const [token, setToken] = useState<string | null>(null)
  const [product, setProduct] = useState<Product | null>(null)
  const [mode, setMode] = useState<Mode>('inspiration')
  const [results, setResults] = useState<Partial<Record<Mode, Result>>>({})
  const [loading, setLoading] = useState<Mode | null>(null)
  const [waited, setWaited] = useState(false)
  const [take, setTake] = useState<Take | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [held, setHeld] = useState<Record<string, string>>({})
  const parentRef = useRef<Window | null>(null)

  const auth = (t: string) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` })

  // Handshake: tell the extension we're ready, accept the token it posts back.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent) return
      const d = e.data
      if (d && d.type === 'myra-token' && typeof d.token === 'string') {
        parentRef.current = e.source as Window
        setToken(d.token)
        if (d.product && typeof d.product.url === 'string') setProduct(d.product)
      }
    }
    window.addEventListener('message', onMessage)
    try { window.parent.postMessage({ type: 'myra-style-ready', url: productUrl }, '*') } catch {}
    const t = setTimeout(() => setWaited(true), 3000)
    return () => { window.removeEventListener('message', onMessage); clearTimeout(t) }
  }, [productUrl])

  // Who is looking, and MYRA's take on the piece itself — both once per open.
  useEffect(() => {
    if (!token || !product) return
    fetch('/api/mirror/me', { headers: auth(token) }).then((r) => r.json()).then(setMe).catch(() => {})
    fetch('/api/mirror/take', { method: 'POST', headers: auth(token), body: JSON.stringify({ product }) }).then((r) => r.json()).then(setTake).catch(() => {})
  }, [token, product])

  const hold = async (key: string, look?: LookItem[]) => {
    if (!token || !product) return
    setHeld((h) => ({ ...h, [key]: '…' }))
    const r = await fetch('/api/mirror/hold', { method: 'POST', headers: auth(token), body: JSON.stringify({ product, look: look ?? null }) }).then((x) => x.json()).catch(() => ({ error: 'failed' }))
    setHeld((h) => ({ ...h, [key]: r.error ? `✕ ${r.error}` : `Held · ${r.held} waiting` }))
  }
  const first = (me?.name ?? '').split(' ')[0]

  useEffect(() => {
    if (!token || !product || results[mode] || loading === mode) return
    let cancelled = false
    setLoading(mode)
    fetch('/api/mirror/style', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...product, mode }),
    })
      .then((r) => r.json())
      .then((res: Result) => { if (!cancelled) setResults((prev) => ({ ...prev, [mode]: res })) })
      .catch(() => { if (!cancelled) setResults((prev) => ({ ...prev, [mode]: { looks: [], error: 'MYRA could not reach the styling room' } })) })
      .finally(() => { if (!cancelled) setLoading(null) })
    return () => { cancelled = true }
  }, [token, product, mode, results, loading])

  const close = () => { try { window.parent.postMessage({ type: 'myra-style-close' }, '*') } catch {} }
  const res = results[mode]

  return (
    <main style={{ minHeight: '100vh', background: '#F7F6F3', color: '#2B2B2B', fontFamily: 'inherit' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 0' }}>
        <span style={{ fontSize: 12, letterSpacing: '0.22em', textTransform: 'uppercase' }}>MYRA · Style</span>
        <button onClick={close} aria-label="Close" style={{ background: 'none', border: 0, fontSize: 22, lineHeight: 1, cursor: 'pointer', color: 'inherit' }}>×</button>
      </header>
      {product && (
        <p style={{ margin: '10px 16px 0', fontSize: 15, lineHeight: 1.4, opacity: 0.8 }}>
          {[product.brand, product.title].filter(Boolean).join(' — ')}
        </p>
      )}
      {token && (
        <div style={{ margin: '12px 16px 0', padding: '12px 14px', background: '#fff', border: '1px solid #2B2B2B' }}>
          {take ? (
            take.error ? <p style={{ margin: 0, fontSize: 15 }}>{take.error}</p> : (
              <>
                <p style={{ margin: 0, fontSize: 13, letterSpacing: '0.18em', textTransform: 'uppercase' }}>MYRA {take.confidence}%{me?.actingAdmin && first ? ` · for ${first}` : ''}</p>
                <p style={{ margin: '6px 0 0', fontSize: 16, lineHeight: 1.4 }}>{take.line}</p>
                {!!take.owns?.length && <p style={{ margin: '6px 0 0', fontSize: 15, opacity: 0.7 }}>Already owned: {take.owns.map((o) => [o.brand, o.product_name].filter(Boolean).join(' ')).join(' · ')}</p>}
              </>
            )
          ) : <p style={{ margin: 0, fontSize: 15, opacity: 0.7 }}>MYRA is looking at this piece…</p>}
          {me?.actingAdmin && (
            <button onClick={() => hold('piece')} disabled={!!held.piece && held.piece === '…'} style={{ marginTop: 10, width: '100%', font: 'inherit', fontSize: 13, letterSpacing: '0.16em', textTransform: 'uppercase', padding: '10px 12px', background: '#141414', color: '#F7F6F3', border: 0, cursor: 'pointer' }}>
              {held.piece ?? `Hold for ${first || 'her'}`}
            </button>
          )}
        </div>
      )}
      <nav style={{ display: 'flex', gap: 18, padding: '14px 16px 0', borderBottom: '1px solid rgba(43,43,43,.15)' }}>
        {MODES.map((m) => (
          <button key={m.id} onClick={() => setMode(m.id)} style={{
            background: 'none', border: 0, padding: '0 0 10px', cursor: 'pointer', color: 'inherit',
            fontSize: 13, letterSpacing: '0.16em', textTransform: 'uppercase',
            borderBottom: mode === m.id ? '2px solid #2B2B2B' : '2px solid transparent', opacity: mode === m.id ? 1 : 0.6,
          }}>{m.label}</button>
        ))}
      </nav>

      <section style={{ padding: '16px' }}>
        {!token && !waited && <p style={{ fontSize: 16 }}>Connecting to MYRA…</p>}
        {!token && waited && <p style={{ fontSize: 16 }}>Open this from the MYRA Mirror extension.</p>}
        {token && (loading === mode || (!res && !loading)) && (
          <div>
            <p style={{ fontSize: 17, margin: '4px 0 12px' }}>MYRA is looking at this piece…</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
              {[0, 1, 2].map((i) => <div key={i} style={{ aspectRatio: '3 / 4', background: '#E4E2DD' }} />)}
            </div>
          </div>
        )}
        {token && res && loading !== mode && (
          res.looks.length ? (
            <div style={{ display: 'grid', gap: 18 }}>
              {res.looks.map((look, i) => (
                <article key={i} style={{ background: '#fff', border: '1px solid #2B2B2B' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(4, Math.max(2, look.items.length))}, 1fr)`, gap: 4, padding: 4, background: '#E4E2DD' }}>
                    {look.items.map((it, j) => (
                      <div key={j} title={it.product_name} style={{ position: 'relative', aspectRatio: '3 / 4', background: '#fff', overflow: 'hidden', outline: it.item_id === res.hero?.item_id ? '2px solid #2B2B2B' : 'none', outlineOffset: -2 }}>
                        {it.image_url && <FallbackImage src={it.image_url} thumbWidth={300} alt={it.product_name} className="absolute inset-0 w-full h-full object-contain" />}
                      </div>
                    ))}
                  </div>
                  <div style={{ padding: '12px 14px 14px' }}>
                    <p style={{ fontSize: 16, lineHeight: 1.4, margin: 0 }}>{look.why}</p>
                    <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0', display: 'grid', gap: 6 }}>
                      {look.items.filter((it) => it.item_id !== res.hero?.item_id).map((it, j) => (
                        <li key={j} style={{ fontSize: 15, lineHeight: 1.35, display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                          <span>
                            {it.owned ? <span style={{ opacity: 0.6 }}>your </span> : <span style={{ opacity: 0.6 }}>{it.brand} </span>}
                            {it.item_id && !it.owned && it.url ? (
                              <ShopLink item={{ item_id: it.item_id, retailer_url: it.url, product_name: it.product_name, brand: { name: it.brand } }} className="underline underline-offset-2">
                                {it.product_name}
                              </ShopLink>
                            ) : it.product_name}
                          </span>
                          {!it.owned && it.price_gbp != null && <span style={{ whiteSpace: 'nowrap' }}>£{Math.round(it.price_gbp)}</span>}
                        </li>
                      ))}
                    </ul>
                    {me?.actingAdmin && (
                      <button onClick={() => hold(`look-${i}`, look.items)} style={{ marginTop: 10, width: '100%', font: 'inherit', fontSize: 13, letterSpacing: '0.16em', textTransform: 'uppercase', padding: '10px 12px', background: 'transparent', color: '#141414', border: '1px solid #141414', cursor: 'pointer' }}>
                        {held[`look-${i}`] ?? `Add this look for ${first || 'her'}`}
                      </button>
                    )}
                  </div>
                </article>
              ))}
              {!!res.hidden && <p style={{ fontSize: 13, opacity: 0.6, margin: 0 }}>{res.hidden} look{res.hidden === 1 ? '' : 's'} held back by the check.</p>}
            </div>
          ) : (
            <p style={{ fontSize: 17, lineHeight: 1.45 }}>{res.error ?? 'No looks for this piece yet.'}</p>
          )
        )}
      </section>
    </main>
  )
}
