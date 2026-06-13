'use client'

import { useEffect, useRef, useState } from 'react'

export interface ReelProduct {
  id: string
  brand: string
  name: string
  price: string
  image: string | null
  url: string
}

// Fixed internal design canvas (3:4). The whole stage is scaled to fit its
// responsive wrapper, so positions/sizes stay pixel-stable for screen-recording.
const STAGE_W = 600
const STAGE_H = 800
const STAGE_STAGGER = 600 // ms between each card appearing

export default function LookShopperReel({
  heroImage,
  products,
}: {
  heroImage: string | null
  products: ReelProduct[]
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [open, setOpen] = useState(false)
  const [added, setAdded] = useState<Record<string, boolean>>({})
  const [playKey, setPlayKey] = useState(0) // bump to replay

  // Scale the fixed stage to fill the responsive wrapper width.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const apply = () => setScale(el.clientWidth / STAGE_W)
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Cascade: open the panel shortly after (re)play.
  useEffect(() => {
    setOpen(false)
    setAdded({})
    const t = setTimeout(() => setOpen(true), 700)
    return () => clearTimeout(t)
  }, [playKey, products.length])

  const ctaDelay = open ? products.length * STAGE_STAGGER + 200 : 0

  return (
    <div>
      <div ref={wrapRef} className="looksh-wrap">
        <div className="looksh" style={{ transform: `scale(${scale})` }}>
          <div className={`screen ${open ? 'is-open' : ''}`}>
            {/* Hero outfit image — model shifted right; blurred copy fills the
                left so the cards sit over a colour-matched backdrop, not the model. */}
            <div className="look-stage">
              {heroImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="look-blur" src={heroImage} alt="" aria-hidden draggable={false} />
              )}
              <div className="look-figure">
                {heroImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="look-img" src={heroImage} alt="" draggable={false} />
                ) : (
                  <div className="look-img look-empty">NO DISPLAY IMAGE</div>
                )}
                <div className="bg-tint" />
              </div>
            </div>

            {/* Shop-the-look panel */}
            <aside className={`product-panel ${open ? 'is-open' : ''}`}>
              <div className="panel-header">
                <span className="panel-title">Shop the look</span>
                <span className="panel-count">{products.length}</span>
              </div>
              <div className="panel-cards">
                {products.map((p, i) => (
                  <article
                    key={p.id}
                    className={`product-card ${open ? 'is-in' : ''}`}
                    style={{ transitionDelay: `${open ? i * STAGE_STAGGER : (products.length - 1 - i) * 30}ms` }}
                  >
                    <div className="card-swatch">
                      {p.image && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          className="card-swatch-img"
                          src={p.image}
                          alt=""
                          draggable={false}
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                        />
                      )}
                    </div>
                    <div className="card-meta">
                      <div className="card-brand">{p.brand}</div>
                      <div className="card-name">{p.name}</div>
                      <div className="card-row">
                        <span className="card-price">{p.price}</span>
                        <button
                          type="button"
                          className={`card-add ${added[p.id] ? 'is-added' : ''}`}
                          onClick={() => setAdded((s) => ({ ...s, [p.id]: !s[p.id] }))}
                        >
                          {added[p.id] ? '✓ Added' : '+ Add'}
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </aside>

            {/* Add look to cart */}
            <button
              type="button"
              className={`add-look-cta ${open ? 'is-in' : ''}`}
              style={{ transitionDelay: `${ctaDelay}ms` }}
            >
              Add look to cart
            </button>
          </div>

          {/* Scoped styles — every selector is qualified under .looksh so it can't
              leak into the rest of the admin UI. */}
          <style dangerouslySetInnerHTML={{ __html: SCOPED_CSS }} />
        </div>
      </div>

      {/* Replay control (outside the 3:4 frame so it's not in the recording) */}
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setPlayKey((k) => k + 1)}
          className="bg-[#0A0A0A] text-white px-5 py-2.5 text-[10px] tracking-[0.20em] hover:bg-[#333] transition-colors"
        >
          ↻ REPLAY ANIMATION
        </button>
        <span className="text-[9px] tracking-[0.15em] text-[#A8A8A4]">
          SCREEN-RECORD THE FRAME ABOVE FOR YOUR REEL
        </span>
      </div>
    </div>
  )
}

const SCOPED_CSS = `
.looksh-wrap {
  position: relative;
  width: 100%;
  max-width: 480px;
  aspect-ratio: 3 / 4;
  overflow: hidden;
  border-radius: 6px;
  background: #b8ab9b;
  box-shadow: 0 12px 40px rgba(0,0,0,0.18);
}
.looksh {
  position: absolute;
  top: 0; left: 0;
  width: ${STAGE_W}px;
  height: ${STAGE_H}px;
  transform-origin: top left;
  font-family: 'Helvetica Neue','Helvetica','Arial',sans-serif;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  color: #14110e;
  --accent: #14110e;
}
.looksh .screen {
  position: absolute; inset: 0;
  overflow: hidden;
  background: radial-gradient(120% 90% at 50% 36%, #c8bba9 0%, #b3a594 55%, #968976 100%);
}
.looksh .look-stage { position: absolute; inset: 0; overflow: hidden; z-index: 1; }
.looksh .look-figure { position: absolute; inset: 0; }
.looksh .look-img { display: block; width: 100%; height: 100%; object-fit: cover; user-select: none; -webkit-user-drag: none; }
.looksh .look-empty {
  display: flex; align-items: center; justify-content: center;
  background: #968976; color: rgba(255,255,255,0.8);
  font-size: 12px; letter-spacing: 0.18em;
}
.looksh .bg-tint {
  position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(180deg, rgba(20,17,14,0.10) 0%, transparent 16%, transparent 78%, rgba(20,17,14,0.28) 100%);
}

.looksh .product-panel {
  position: absolute; top: 54px; left: 20px;
  width: 178px;
  display: flex; flex-direction: column; gap: 7px;
  z-index: 5; pointer-events: none;
}
.looksh .panel-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 4px 2px;
  opacity: 0; transform: translateX(-20px);
  transition: opacity 0.4s ease, transform 0.4s ease;
}
.looksh .product-panel.is-open .panel-header { opacity: 1; transform: translateX(0); }
.looksh .panel-title {
  font-weight: 800; font-size: 8.5px; letter-spacing: 0.16em;
  color: #fff; text-shadow: 0 1px 6px rgba(0,0,0,0.4);
}
.looksh .panel-count {
  font-weight: 700; font-size: 8.5px; color: rgba(255,255,255,0.9);
  background: rgba(255,255,255,0.18); padding: 1px 6px; border-radius: 999px;
  letter-spacing: 0.06em;
}
.looksh .panel-cards { display: flex; flex-direction: column; gap: 6px; }

.looksh .product-card {
  background: #fff; border-radius: 4px; padding: 7px;
  display: grid; grid-template-columns: 38px 1fr; gap: 8px; align-items: center;
  height: 62px;
  opacity: 0; transform: translateX(-80px) scale(0.96);
  transition: opacity 0.5s cubic-bezier(.2,.8,.2,1), transform 0.55s cubic-bezier(.2,.8,.2,1);
  box-shadow: 0 6px 18px rgba(0,0,0,0.18);
  pointer-events: auto;
}
.looksh .product-card.is-in { opacity: 1; transform: translateX(0) scale(1); }
.looksh .card-swatch { width: 38px; height: 38px; border-radius: 3px; position: relative; overflow: hidden; background: #ece5d8; }
.looksh .card-swatch-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.looksh .card-meta { display: flex; flex-direction: column; gap: 0; min-width: 0; }
.looksh .card-brand {
  font-weight: 800; font-size: 6.5px; letter-spacing: 0.1em; color: #6a655c;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.looksh .card-name {
  font-weight: 700; font-size: 8.5px; letter-spacing: 0.01em; line-height: 1.1; color: #14110e;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.looksh .card-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: 3px; }
.looksh .card-price { font-size: 8.5px; font-weight: 800; letter-spacing: 0.03em; }
.looksh .card-add {
  font-weight: 800; font-size: 6.5px; letter-spacing: 0.08em; text-transform: uppercase;
  background: var(--accent); color: #fff; border: none; border-radius: 2px;
  padding: 4px 8px; cursor: pointer; transition: background 0.2s ease; white-space: nowrap;
}
.looksh .card-add.is-added { background: #2f6a3a; }

/* Add-to-cart centered along the bottom. */
.looksh .add-look-cta {
  position: absolute; bottom: 12px; left: 50%;
  transform: translate(-50%, 26px);
  text-align: center;
  background: #14110e; color: #fff; border: none; border-radius: 4px;
  padding: 10px 28px;
  font-weight: 700; font-size: 8.5px; letter-spacing: 0.12em; text-transform: uppercase;
  cursor: pointer; z-index: 6; opacity: 0; white-space: nowrap;
  transition: opacity 0.5s ease, transform 0.5s cubic-bezier(.2,.8,.2,1), background 0.2s ease;
  box-shadow: 0 8px 24px rgba(0,0,0,0.25);
}
.looksh .add-look-cta.is-in { opacity: 1; transform: translate(-50%, 0); }
.looksh .add-look-cta:hover { background: #2a2520; }
`
