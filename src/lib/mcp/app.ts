// MYRA, DRAWN INSIDE AN ASSISTANT.
//
// Claude and ChatGPT both render an MCP App: a tool names a ui:// resource,
// the host loads that HTML in a sandboxed frame and posts the tool's result
// into it (MCP Apps, protocol 2026-01-26; ChatGPT reads the same keys and
// also its older openai/* aliases). So an outfit arrives the way a shop's app
// does — each piece a card with its picture, brand, name and price — instead
// of a list of names the assistant has to retype.
//
// No SDK: the page speaks the postMessage JSON-RPC itself. Pictures are
// served through MYRA's own domain so one CSP entry covers every shop.

export const APP_URI = 'ui://myra/pieces.html'
export const APP_MIME = 'text/html;profile=mcp-app'
export const APP_PROTOCOL = '2026-01-26'

// www answers; the bare domain fails TLS (lib/studio/email says the same).
const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.myraassistant.co.uk').replace(/\/$/, '')
const siteUrl = (path: string) => `${SITE}${path}`

/** The tool `_meta` that asks the host to draw the result with the app. */
export const APP_TOOL_META = {
  ui: { resourceUri: APP_URI },
  // ChatGPT's own names for the same thing, still honoured.
  'openai/outputTemplate': APP_URI,
  'openai/toolInvocation/invoking': 'MYRA is styling…',
  'openai/toolInvocation/invoked': 'Styled by MYRA',
  'openai/widgetAccessible': true,
} as const

/** The resource as it is listed, with what the frame may load. */
export const APP_RESOURCE = {
  uri: APP_URI,
  name: 'MYRA pieces',
  title: 'MYRA',
  description: 'Outfits and pieces from MYRA, drawn as cards with their pictures and prices.',
  mimeType: APP_MIME,
  _meta: {
    ui: { prefersBorder: true, csp: { resourceDomains: [SITE], connectDomains: [] as string[] } },
    'openai/widgetDescription': 'Outfits and pieces from MYRA, each with its picture and price.',
    'openai/widgetPrefersBorder': true,
    'openai/widgetCSP': { connect_domains: [] as string[], resource_domains: [SITE] },
  },
}

/** A piece as the app draws it. */
export interface AppPiece {
  name: string
  brand: string
  price_gbp: number | null
  owned: boolean
  url: string | null
  /** Through MYRA's own image route, so the frame's CSP allows it. */
  image_url: string | null
}

export interface AppLooks { kind: 'looks'; title: string; looks: { pieces: AppPiece[]; why: string }[] }
export interface AppPieces { kind: 'pieces'; title: string; pieces: AppPiece[] }

/** A shop's picture, routed through MYRA so the frame may show it. */
export function appPicture(url: string | null | undefined): string | null {
  if (!url) return null
  if (url.startsWith(SITE)) return url
  return siteUrl(`/_next/image?url=${encodeURIComponent(url)}&w=640&q=75`)
}

export const appPiece = (p: { name: string; brand: string; price_gbp: number | null; owned: boolean; url: string | null; image_url: string | null }): AppPiece => ({
  name: p.name, brand: p.brand, price_gbp: p.price_gbp, owned: p.owned, url: p.url, image_url: appPicture(p.image_url),
})

/**
 * The page itself. Black and silver only; pieces as 3:4 cards in a row per
 * look; a tap on a card opens the shop through the host. It asks the host to
 * initialise, takes the tool result from the notification, and reports its
 * height so the frame fits.
 */
export const APP_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MYRA</title>
<style>
  :root { --ink: #0A0A0A; --silver: #7C838B; --line: #E2E0DB; --paper: #FFFFFF; --card: #FFFFFF; }
  [data-theme="dark"] { --ink: #F2F2F0; --silver: #A2A7AD; --line: #3A3A3C; --paper: #1C1C1E; --card: #262628; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--paper); color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif; }
  body { padding: 14px 14px 10px; }
  .title { font-size: 13px; letter-spacing: .14em; text-transform: uppercase; color: var(--silver); margin: 0 0 12px; display:flex; align-items:center; gap:10px; }
  .title b { color: var(--ink); font-weight: 600; letter-spacing: .18em; }
  .look { margin: 0 0 18px; }
  .look-label { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--silver); margin: 0 0 8px; }
  .row { display: grid; grid-template-columns: repeat(auto-fill, minmax(128px, 1fr)); gap: 10px; }
  .piece { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: var(--card); cursor: pointer; text-align: left; padding: 0; color: inherit; font: inherit; display:block; width:100%; }
  .piece:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
  .pic { width: 100%; aspect-ratio: 3 / 4; background: #FFFFFF; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .pic img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .pic .none { font-size: 11px; letter-spacing: .1em; color: var(--silver); text-transform: uppercase; }
  .meta { padding: 8px 10px 10px; }
  .brand { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--silver); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .name { font-size: 14px; line-height: 1.3; margin: 3px 0 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .price { font-size: 14px; font-weight: 600; }
  .price.yours { font-weight: 500; color: var(--silver); letter-spacing: .08em; font-size: 12px; text-transform: uppercase; }
  .why { font-size: 13px; line-height: 1.45; color: var(--silver); margin: 8px 0 0; }
  .empty { font-size: 14px; color: var(--silver); }
</style>
</head>
<body>
<div id="root"><p class="empty">MYRA is styling…</p></div>
<script>
(function () {
  var root = document.getElementById('root');
  var nextId = 1, initId = null, hostLinks = false;
  var legacy = typeof window.openai === 'object' && window.openai;

  function post(msg) { try { window.parent.postMessage(msg, '*'); } catch (e) {} }
  function request(method, params) { var id = nextId++; post({ jsonrpc: '2.0', id: id, method: method, params: params || {} }); return id; }
  function notify(method, params) { post({ jsonrpc: '2.0', method: method, params: params || {} }); }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function price(p) {
    if (p.owned) return '<div class="price yours">◈ Yours</div>';
    if (p.price_gbp == null || isNaN(Number(p.price_gbp))) return '';
    return '<div class="price">£' + Math.round(Number(p.price_gbp)).toLocaleString('en-GB') + '</div>';
  }
  function card(p, i) {
    var pic = p.image_url ? '<img src="' + esc(p.image_url) + '" alt="" loading="lazy">' : '<span class="none">No picture</span>';
    return '<button class="piece" type="button" data-i="' + i + '" aria-label="' + esc(p.brand + ' ' + p.name) + '">'
      + '<div class="pic">' + pic + '</div>'
      + '<div class="meta"><div class="brand">' + esc(p.brand || (p.owned ? 'Hers' : '')) + '</div>'
      + '<div class="name">' + esc(p.name) + '</div>' + price(p) + '</div></button>';
  }

  var pieces = [];
  function render(data) {
    pieces = [];
    if (!data || typeof data !== 'object') { root.innerHTML = '<p class="empty">Nothing to show.</p>'; return fit(); }
    var html = '<p class="title"><b>MYRA</b>' + (data.title ? '<span>' + esc(data.title) + '</span>' : '') + '</p>';
    if (data.kind === 'looks' && Array.isArray(data.looks) && data.looks.length) {
      data.looks.forEach(function (l, li) {
        html += '<section class="look"><p class="look-label">Look ' + (li + 1) + '</p><div class="row">';
        (l.pieces || []).forEach(function (p) { html += card(p, pieces.length); pieces.push(p); });
        html += '</div>' + (l.why ? '<p class="why">' + esc(l.why) + '</p>' : '') + '</section>';
      });
    } else if (Array.isArray(data.pieces) && data.pieces.length) {
      html += '<div class="row">';
      data.pieces.forEach(function (p) { html += card(p, pieces.length); pieces.push(p); });
      html += '</div>';
    } else {
      html += '<p class="empty">' + esc(data.note || 'Nothing to show yet.') + '</p>';
    }
    root.innerHTML = html;
    fit();
  }

  root.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.piece') : null;
    if (!b) return;
    var p = pieces[Number(b.getAttribute('data-i'))];
    if (!p || !p.url) return;
    if (legacy && typeof legacy.openExternal === 'function') { legacy.openExternal({ href: p.url }); return; }
    if (hostLinks) { request('ui/open-link', { url: p.url }); return; }
    try { window.open(p.url, '_blank', 'noopener'); } catch (err) {}
  });

  var lastH = 0;
  function fit() {
    var h = Math.ceil(document.documentElement.scrollHeight || document.body.scrollHeight);
    if (h && h !== lastH) { lastH = h; notify('ui/notifications/size-changed', { width: Math.ceil(document.documentElement.scrollWidth || document.body.scrollWidth), height: h }); }
  }
  if (window.ResizeObserver) new ResizeObserver(fit).observe(document.body);
  window.addEventListener('load', fit);
  root.addEventListener('load', fit, true);

  function theme(ctx) {
    var t = ctx && ctx.theme;
    if (!t && legacy && legacy.theme) t = legacy.theme;
    document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light');
  }

  window.addEventListener('message', function (e) {
    var m = e.data;
    if (!m || m.jsonrpc !== '2.0') return;
    if (m.id != null && m.id === initId && m.result) {
      hostLinks = true;
      theme(m.result.hostContext);
      notify('ui/notifications/initialized');
      return;
    }
    if (m.method === 'ui/notifications/tool-result') {
      var r = m.params || {};
      if (r.structuredContent) render(r.structuredContent);
      else if (r.isError) root.innerHTML = '<p class="empty">' + esc((r.content && r.content[0] && r.content[0].text) || 'MYRA could not answer that.') + '</p>';
    } else if (m.method === 'ui/notifications/host-context-changed') {
      theme(m.params);
    }
  });

  // ChatGPT's older surface hands the result over as a global instead.
  if (legacy) {
    theme(null);
    if (legacy.toolOutput) render(legacy.toolOutput);
    window.addEventListener('openai:set_globals', function (ev) {
      var g = ev && ev.detail && ev.detail.globals;
      if (g && g.toolOutput) render(g.toolOutput);
      if (g && g.theme) theme({ theme: g.theme });
    });
  }

  initId = request('ui/initialize', {
    protocolVersion: '${APP_PROTOCOL}',
    clientInfo: { name: 'MYRA', version: '1.0.0' },
    appCapabilities: { availableDisplayModes: ['inline'] },
  });
})();
</script>
</body>
</html>`
