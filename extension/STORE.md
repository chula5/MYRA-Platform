# MYRA Mirror — Chrome Web Store listing

Everything the store asks for, ready to paste. The zip comes from
`node scripts/pack-extension.mjs` → `extension-dist/myra-mirror-<version>.zip`.

## Before you start (the two things only you can do)

1. **A Chrome Web Store developer account** at
   https://chrome.google.com/webstore/devconsole — sign in with the Google
   account you want to own the extension (it stays tied to it), pay the
   one-off US$5 registration, accept the developer agreement.
2. **Vercel env var after it's live:** `NEXT_PUBLIC_MIRROR_STORE_URL` = the
   listing URL the store gives you. Redeploy. The "1. Add to Chrome" button on
   `/me/welcome` lights up by itself.

## Upload

Developer console → **New item** → upload the zip. Then the tabs below.

## Store listing

**Name** — MYRA Mirror

**Summary** (≤132 chars, this is the manifest description) —
Every brand site, already in your order. MYRA lifts the pieces you'd want to the top — the site stays the brand's own.

**Description** —

MYRA Mirror is for MYRA members. Connect it once to your MYRA, and every brand or retailer site you open in Chrome is quietly re-ordered so the pieces you would actually wear come first. Nothing is added, restyled or hidden — the site stays exactly the brand's own, in your order.

On any product page, MYRA offers two things: save the piece to your MYRA, where it watches stock in your size and tells you if it starts to go; or ask what you would wear it with — three looks built around it from your own wardrobe or from MYRA's pieces.

It only reads the shop pages you open. It never reads anything else, never follows you between sites, and you can switch it off for any site from its menu. Disconnect at any time; that removes your MYRA connection from the browser.

You need a MYRA account. MYRA is a private styling service — if you're not a member yet, this extension will ask you to sign in and stop there.

**Category** — Shopping
**Language** — English (UK)

**Store icon** — `extension/icons/icon-128.png`
**Screenshots** (1280×800, at least one) — `extension-dist/store/screenshot-panel.png`
is made from a real session. Take one more on a brand site with the pill in
the corner (the extension installed and connected, any product page, ⌘⇧4)
and resize it to 1280×800 — the store shows the first screenshot largest.
**Small promo tile** (440×280, optional) — `extension-dist/store/promo-440x280.png`

## Privacy tab

**Single purpose** —
Re-orders product listings on shopping sites into the signed-in MYRA member's taste order, and lets her save a piece or ask MYRA what to wear it with.

**Permission justifications** —

- `host_permissions: <all_urls>` and content scripts on all sites — MYRA members shop at hundreds of independent brands and retailers that cannot be known in advance; the extension has to be able to read the product grid on whichever shop she opens. It acts only on pages that contain a product listing or a single product, and does nothing on any other page.
- `tabs` — to open the MYRA connect page when she presses Connect, and to tell the open shop tab when the looks she asked for are ready.
- `storage` — to keep her MYRA connection (a signed token, her first name) and the list of sites she has switched the extension off for, on this device only.

**Remote code** — No, this extension does not use remote code.

**Data usage** — tick these, and only these:

- **Web history** → *No.* (It reads the current shop page's products; it does not record which sites were visited or keep any history.)
- **User activity** → *Yes* — clicks. Only her own actions inside the extension: pressing Save, or asking for looks. Nothing else on the page is recorded.
- **Website content** → *Yes* — text, images and links from product listings on the shop page she has open (product names, prices, images, product URLs), sent to MYRA so it can order them to her taste.
- **Authentication information** → *Yes* — a signed MYRA member token, stored in the browser so the extension knows whose taste it is carrying.
- Personally identifiable information, health, financial and payment, personal communications, location → *No.*

**Certifications** — tick all three:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL** — https://www.myraassistant.co.uk/privacy
(the page has a section on MYRA for Chrome)

## Distribution tab

**Visibility** — **Unlisted.** Only people with the link can find and install it; there is no public listing. That is what a private styling service wants. You can change it later.

**Regions** — All regions is fine; the extension does nothing without a MYRA account.

## Submit

**Submit for review.** Review usually takes a few days; extensions asking for `<all_urls>` are looked at more closely, which is what the justifications above are for. You'll get an email either way. If they ask a question, the answer is almost always in this file.

## After it's live

1. Copy the listing URL (it looks like `https://chromewebstore.google.com/detail/myra-mirror/<id>`).
2. Vercel → the MYRA project → Settings → Environment Variables → add
   `NEXT_PUBLIC_MIRROR_STORE_URL` with that URL → redeploy.
3. On `/me/welcome`, the Chrome card now offers **1. Add to Chrome** → store, then **2. Connect it to me** → `/mirror/connect`. That is the whole journey for a client.

## Updating later

Bump `version` in `extension/manifest.json`, `node scripts/pack-extension.mjs`, upload the new zip in the console under **Package**, submit. Members get the update automatically.

## Developing locally now that the store build points at production

The extension's default API is `https://www.myraassistant.co.uk`. For your
unpacked dev copy, open the popup → the small **advanced** line → set the
API to `http://localhost:3000` once. It is stored on your machine only.
