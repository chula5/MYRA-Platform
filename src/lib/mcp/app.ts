// MYRA, DRAWN INSIDE AN ASSISTANT.
//
// Claude and ChatGPT both render an MCP App: a tool names a ui:// resource,
// the host loads that HTML in a sandboxed frame and posts the tool's result
// into it (MCP Apps, protocol 2026-01-26; ChatGPT reads the same keys and
// also its older openai/* aliases). So an outfit arrives the way it does in
// her own feed — one styled picture per look, the pieces listed under it with
// a heart on each — instead of a list of names the assistant has to retype.
//
// No SDK: the page speaks the postMessage JSON-RPC itself. Pictures are
// served through MYRA's own domain so one CSP entry covers every shop. A
// heart calls the server's save_piece tool through the host, so the frame
// never needs a network connection of its own.

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

/** The `_meta` of a tool the app itself may call (a heart), as well as the model. */
export const APP_CALLABLE_META = {
  ui: { visibility: ['model', 'app'] },
  'openai/widgetAccessible': true,
} as const

/** The resource as it is listed, with what the frame may load. */
export const APP_RESOURCE = {
  uri: APP_URI,
  name: 'MYRA looks',
  title: 'MYRA',
  description: 'Looks from MYRA, drawn as in her feed: the outfit styled, the pieces under it with their prices, a heart on each.',
  mimeType: APP_MIME,
  _meta: {
    ui: { prefersBorder: true, csp: { resourceDomains: [SITE], connectDomains: [] as string[] } },
    'openai/widgetDescription': 'Looks from MYRA, each the outfit styled with its pieces and prices under it.',
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
  /** MYRA's id, so the heart can save it; null when the piece is not hers to save. */
  item_id: string | null
  /** Already on her saved shelf. */
  saved: boolean
}

export interface AppLook {
  /** The outfit styled: the anchor piece worn, through MYRA's image route. */
  image_url: string | null
  pieces: AppPiece[]
  why: string
}
export interface AppLooks { kind: 'looks'; title: string; looks: AppLook[] }
export interface AppPieces { kind: 'pieces'; title: string; pieces: AppPiece[] }

/** A shop's picture, routed through MYRA so the frame may show it. */
export function appPicture(url: string | null | undefined, width = 640): string | null {
  if (!url) return null
  if (url.startsWith(SITE)) return url
  return siteUrl(`/_next/image?url=${encodeURIComponent(url)}&w=${width}&q=75`)
}

export const appPiece = (
  p: { name: string; brand: string; price_gbp: number | null; owned: boolean; url: string | null; image_url: string | null; item_id?: string | null },
  saved = false,
): AppPiece => ({
  name: p.name, brand: p.brand, price_gbp: p.price_gbp, owned: p.owned, url: p.url, image_url: appPicture(p.image_url),
  item_id: p.owned ? null : (p.item_id ?? null), saved,
})

/**
 * The page itself. Black and silver only, as her feed: looks side by side
 * when there is room, each one its styled picture (3:4) with the pieces in
 * rows under it — thumbnail, brand, name, price, heart. A tap on a row opens
 * the shop through the host; a tap on the heart saves the piece through the
 * host's tools/call. It asks the host to initialise, takes the tool result
 * from the notification, and reports its height so the frame fits.
 */
export const APP_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MYRA</title>
<style>
  :root { --ink: #0A0A0A; --silver: #7C838B; --line: #E2E0DB; --paper: #FFFFFF; --card: #FFFFFF; --wash: #F4F3F0; }
  [data-theme="dark"] { --ink: #F2F2F0; --silver: #A2A7AD; --line: #3A3A3C; --paper: #1C1C1E; --card: #262628; --wash: #2A2A2C; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--paper); color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif; }
  body { padding: 14px 14px 10px; }
  .title { font-size: 13px; letter-spacing: .14em; text-transform: uppercase; color: var(--silver); margin: 0 0 12px; display:flex; align-items:center; gap:10px; }
  .title b { color: var(--ink); font-weight: 600; letter-spacing: .18em; }
  .looks { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; align-items: start; }
  .look { border: 1px solid var(--line); border-radius: 14px; overflow: hidden; background: var(--card); }
  .hero { position: relative; width: 100%; aspect-ratio: 3 / 4; background: var(--wash); overflow: hidden; cursor: pointer; }
  .hero img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .hero .none { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size: 11px; letter-spacing: .1em; color: var(--silver); text-transform: uppercase; }
  .look-label { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink); font-weight: 600; margin: 0; padding: 12px 12px 0; }
  .why { font-size: 13px; line-height: 1.45; color: var(--silver); margin: 4px 0 0; padding: 0 12px; }
  .pieces { list-style: none; margin: 8px 0 0; padding: 0 6px 6px; }
  .piece { display: flex; align-items: center; gap: 10px; padding: 6px; border-radius: 10px; cursor: pointer; }
  .piece:hover { background: var(--wash); }
  .thumb { width: 52px; height: 68px; flex: 0 0 52px; border-radius: 8px; background: #FFFFFF; border: 1px solid var(--line); overflow: hidden; display:flex; align-items:center; justify-content:center; }
  .thumb img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .meta { flex: 1 1 auto; min-width: 0; }
  .brand { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--silver); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .name { font-size: 14px; line-height: 1.3; margin: 2px 0 2px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .price { font-size: 13px; font-weight: 600; }
  .price.yours { font-weight: 500; color: var(--silver); letter-spacing: .08em; font-size: 11px; text-transform: uppercase; }
  .heart { flex: 0 0 auto; width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--line); background: var(--card); color: var(--ink); font: inherit; font-size: 16px; line-height: 1; display:flex; align-items:center; justify-content:center; cursor: pointer; }
  .heart[aria-pressed="true"] { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .heart:disabled { opacity: .5; cursor: default; }
  .heart:focus-visible, .piece:focus-visible, .hero:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
  .row { display: grid; grid-template-columns: repeat(auto-fill, minmax(128px, 1fr)); gap: 10px; }
  .card { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: var(--card); cursor: pointer; }
  .card .pic { width: 100%; aspect-ratio: 3 / 4; background: #FFFFFF; display:flex; align-items:center; justify-content:center; overflow:hidden; }
  .card .pic img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .card .meta { padding: 8px 10px 10px; display:flex; gap:6px; align-items:flex-start; }
  .card .meta .text { flex: 1 1 auto; min-width: 0; }
  .empty { font-size: 14px; color: var(--silver); }
  .toast { position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); background: var(--ink); color: var(--paper); font-size: 12px; letter-spacing: .1em; text-transform: uppercase; padding: 8px 14px; border-radius: 999px; opacity: 0; transition: opacity .2s; pointer-events: none; }
  .toast.on { opacity: 1; }
</style>
</head>
<body>
<div id="root"><p class="empty">MYRA is styling…</p></div>
<div id="toast" class="toast" role="status"></div>
<script>
(function () {
  var root = document.getElementById('root');
  var toastEl = document.getElementById('toast');
  var nextId = 1, initId = null, hostLinks = false, pending = {};
  var legacy = typeof window.openai === 'object' && window.openai;

  function post(msg) { try { window.parent.postMessage(msg, '*'); } catch (e) {} }
  function request(method, params, cb) { var id = nextId++; if (cb) pending[id] = cb; post({ jsonrpc: '2.0', id: id, method: method, params: params || {} }); return id; }
  function notify(method, params) { post({ jsonrpc: '2.0', method: method, params: params || {} }); }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function price(p) {
    if (p.owned) return '<div class="price yours">◈ Yours</div>';
    if (p.price_gbp == null || isNaN(Number(p.price_gbp))) return '';
    return '<div class="price">£' + Math.round(Number(p.price_gbp)).toLocaleString('en-GB') + '</div>';
  }
  function heart(p, i) {
    if (!p.item_id) return '';
    return '<button class="heart" type="button" data-heart="' + i + '" aria-pressed="' + (p.saved ? 'true' : 'false') + '" aria-label="' + (p.saved ? 'Saved — tap to remove' : 'Save to MYRA') + '">' + (p.saved ? '♥' : '♡') + '</button>';
  }
  function row(p, i) {
    var pic = p.image_url ? '<img src="' + esc(p.image_url) + '" alt="" loading="lazy">' : '';
    return '<li class="piece" tabindex="0" data-i="' + i + '" aria-label="' + esc(p.brand + ' ' + p.name) + '">'
      + '<div class="thumb">' + pic + '</div>'
      + '<div class="meta"><div class="brand">' + esc(p.brand || (p.owned ? 'Hers' : '')) + '</div>'
      + '<div class="name">' + esc(p.name) + '</div>' + price(p) + '</div>' + heart(p, i) + '</li>';
  }
  function card(p, i) {
    var pic = p.image_url ? '<img src="' + esc(p.image_url) + '" alt="" loading="lazy">' : '<span class="none">No picture</span>';
    return '<div class="card" tabindex="0" data-i="' + i + '" aria-label="' + esc(p.brand + ' ' + p.name) + '">'
      + '<div class="pic">' + pic + '</div>'
      + '<div class="meta"><div class="text"><div class="brand">' + esc(p.brand || (p.owned ? 'Hers' : '')) + '</div>'
      + '<div class="name">' + esc(p.name) + '</div>' + price(p) + '</div>' + heart(p, i) + '</div></div>';
  }

  var pieces = [];
  function render(data) {
    pieces = [];
    if (!data || typeof data !== 'object') { root.innerHTML = '<p class="empty">Nothing to show.</p>'; return fit(); }
    var html = '<p class="title"><b>MYRA</b>' + (data.title ? '<span>' + esc(data.title) + '</span>' : '') + '</p>';
    if (data.kind === 'looks' && Array.isArray(data.looks) && data.looks.length) {
      html += '<div class="looks">';
      data.looks.forEach(function (l, li) {
        var first = -1;
        var rows = '';
        (l.pieces || []).forEach(function (p) { if (first < 0 && p.url) first = pieces.length; rows += row(p, pieces.length); pieces.push(p); });
        var hero = l.image_url ? '<img src="' + esc(l.image_url) + '" alt="Look ' + (li + 1) + '" loading="' + (li ? 'lazy' : 'eager') + '">' : '<span class="none">No picture</span>';
        html += '<section class="look"><div class="hero" tabindex="0" data-i="' + first + '" aria-label="Look ' + (li + 1) + '">' + hero + '</div>'
          + '<p class="look-label">Look ' + (li + 1) + '</p>'
          + (l.why ? '<p class="why">' + esc(l.why) + '</p>' : '')
          + '<ul class="pieces">' + rows + '</ul></section>';
      });
      html += '</div>';
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

  function open(url) {
    if (!url) return;
    if (legacy && typeof legacy.openExternal === 'function') { legacy.openExternal({ href: url }); return; }
    if (hostLinks) { request('ui/open-link', { url: url }); return; }
    try { window.open(url, '_blank', 'noopener'); } catch (err) {}
  }

  var toastTimer = null;
  function toast(text) {
    toastEl.textContent = text; toastEl.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.classList.remove('on'); }, 1800);
  }

  function callTool(name, args, cb) {
    if (legacy && typeof legacy.callTool === 'function') {
      Promise.resolve(legacy.callTool(name, args)).then(function (r) { cb(null, r); }, function (e) { cb(e || new Error('failed')); });
      return;
    }
    request('tools/call', { name: name, arguments: args }, function (err, result) { cb(err, result); });
  }

  function toggleHeart(btn) {
    var i = Number(btn.getAttribute('data-heart'));
    var p = pieces[i];
    if (!p || !p.item_id || btn.disabled) return;
    var want = !p.saved;
    btn.disabled = true;
    btn.setAttribute('aria-pressed', want ? 'true' : 'false'); btn.textContent = want ? '♥' : '♡';
    callTool('save_piece', { item_id: p.item_id, saved: want }, function (err, result) {
      btn.disabled = false;
      var failed = !!err || (result && result.isError);
      if (failed) {
        btn.setAttribute('aria-pressed', p.saved ? 'true' : 'false'); btn.textContent = p.saved ? '♥' : '♡';
        toast('Could not save — try in MYRA');
        return;
      }
      p.saved = want;
      btn.setAttribute('aria-label', want ? 'Saved — tap to remove' : 'Save to MYRA');
      toast(want ? 'Saved to MYRA' : 'Removed');
    });
  }

  root.addEventListener('click', function (e) {
    var h = e.target.closest ? e.target.closest('.heart') : null;
    if (h) { e.stopPropagation(); toggleHeart(h); return; }
    var el = e.target.closest ? e.target.closest('[data-i]') : null;
    if (!el) return;
    var p = pieces[Number(el.getAttribute('data-i'))];
    if (p) open(p.url);
  });
  root.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var el = e.target.closest ? e.target.closest('[data-i]') : null;
    if (!el) return;
    e.preventDefault();
    var p = pieces[Number(el.getAttribute('data-i'))];
    if (p) open(p.url);
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
    if (m.id != null && pending[m.id]) {
      var cb = pending[m.id]; delete pending[m.id];
      if (m.error) cb(m.error); else cb(null, m.result);
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
    clientInfo: { name: 'MYRA', version: '1.1.0' },
    appCapabilities: { availableDisplayModes: ['inline'] },
  });
})();
</script>
</body>
</html>`
