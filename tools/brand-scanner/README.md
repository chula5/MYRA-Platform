# Brand Scanner

Give it a brand's landing page. Get the whole catalogue, ranked against your house style,
in one pass. No clicking into collections, no scraping page by page.

## Why this works

Every Shopify store publishes its entire catalogue as JSON at `/products.json` — the same
data the storefront renders from, including tags, materials, colours, prices, publish dates
and every product image. Most fashion brands are on Shopify and most leave this open.

Anonymous Copenhagen: **2,146 products read in about fifteen seconds** — nine pages of 250 —
versus twenty-five collection pages clicked and scraped by hand.

It also means the brand does most of your tagging for you. Anon CPH publishes structured
tags on every product:

```
Category: Heels          Material: Polished soft calf
Color: Black             Sub category: Stiletto heel / Pointy toe / Pump
Main category: Heels     Style reference: Phia 55 pin
```

Those map straight onto the MYRA Item taxonomy — `item_type`, `colour_family`,
`material_category` — with no guessing and no vision model.

---

## Two ways in

### 1. The review tool — `brand-scanner.html`

Open it, paste a brand URL, hit **Scan catalogue**. Everything happens in the page.

If the scan is blocked (some brands sit behind Cloudflare, and a page opened straight from
your disk has no origin), use **Load a saved scan** and point it at a `.json` the Python
script produced, or at any raw `products.json` you've saved. Same result.

### 2. The script — `brand_watch.py`

```bash
python3 brand_watch.py https://www.anoncph.co.uk/     # scan + open the review sheet
python3 brand_watch.py --add https://newbrand.com/    # add to the watchlist
python3 brand_watch.py --check                        # what's new since last time
python3 brand_watch.py --check --images               # and save the images
python3 brand_watch.py --list                         # show the watchlist
```

No API keys, no login, no dependencies beyond stock Python 3.

---

## Reviewing

The sheet shows every product as an image card, ranked by style score. Nothing is hidden —
off-brand pieces sink to the bottom rather than disappearing, so you always see the whole
catalogue and make the call yourself.

- **Keep / Skip** on each card
- Click any image to see it full size
- Filter live by category, colour family, price, publish date, minimum score
- **Approve all shown** — filter to what you want, then take the lot in one click
- **Export for MYRA** — approved items as JSON in the Item table shape
- **Export CSV** — same thing for a spreadsheet

Exported JSON is ready for the Item table:

```json
{
  "product_name": "Phia 55 pin Polished soft calf Black",
  "brand_name": "Anonymous Copenhagen",
  "item_type": "heel",
  "colour_family": "black",
  "material_category": "leather_suede",
  "material_primary": "Polished soft calf",
  "retailer_url": "https://www.anoncph.co.uk/products/phia-55-pin-...",
  "image_url": "https://cdn.shopify.com/.../Packshot_78.jpg",
  "image_urls": ["...", "...", "...", "...", "..."],
  "price_gbp": 275.0,
  "source": "retailer_api",
  "status": "draft"
}
```

`status` lands as `draft` on purpose — the 1–5 scored dimensions (fit, structure, surface,
sheen) still need your eye before anything goes to `ready`.

---

## Images

Yes — captured in full, three ways, and you pick how far to take it:

| What | How |
|---|---|
| **URLs** | Always. Every export carries `image_url` plus up to six `image_urls` per product — the brand's own packshots, full resolution. |
| **Files on disk** | `--images` downloads them to `images/<brand>/<handle>.jpg` at 1400px. |
| **Cloudinary** | `--cloudinary` uploads to `myra/<brand>/<handle>` and writes the hosted URL back into the export. |

For Cloudinary, set these once in your shell (an unsigned preset — no secret key needed):

```bash
export CLOUDINARY_CLOUD_NAME=your-cloud-name
export CLOUDINARY_UPLOAD_PRESET=your-unsigned-preset
```

The review grid requests `?width=500` thumbnails rather than the originals — 13KB a card
instead of 198KB, which is what keeps a 900-item grid usable.

---

## Watching for new drops

`state.json` remembers every product ID it has already shown you, per brand. On the next
check, anything not in that list is new — which catches new colourways and quiet restocks,
not just whole collections.

Double-click **`install-schedule.command`** once and macOS checks every watched brand once a week,
on Monday mornings, whether or not Claude is open. New drops land as a review sheet in `review/`.

Stop it any time:

```bash
launchctl bootout gui/$UID/com.myra.brandwatch
```

---

## Tuning the house style

`house_style.json` is written on first run. Both the script and the HTML tool read the same
shape, and the HTML tool lets you edit the rules inline and re-rank instantly.

Scoring is additive, not a gate: `+3` a house colour, `+2` a house material, `+2` a house
silhouette, and the same values negative for things that are off. Range runs about `-7` to `+7`.

Defaults are seeded from your reference universe — Khaite, Toteme, The Row, St. Agni, Alaïa,
Isabel Marant. Neutrals and considered leathers score up. Leopard, neon, platforms, heavy
metallics score down.

Use the score slider with **New only** for the realistic first sitting: filter to `+5` and
the last 60 days, review that, then relax the slider and work down the ranking.

Only a small share of a well-chosen brand scores negative, which is the point — the job is
ranking rather than rejecting.

---

## When a brand isn't on Shopify

The script says so rather than failing quietly. Those need the browser route — ask Claude to
scan it with Claude in Chrome, which reads the rendered page instead of the feed.

Rough odds: most independent and contemporary fashion brands are on Shopify. Big luxury
e-tailers (Net-a-Porter, Farfetch, Mytheresa, SSENSE) are not, and will need the browser.
