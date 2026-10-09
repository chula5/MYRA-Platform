// MYRA Mirror on Brand Watch — the one thing the admin page cannot do alone.
//
// A page can open a tab, but only in front of her; the extension can open one
// BEHIND her. So Brand Watch's SCAN IN CHROME puts the page to open on the
// document and raises an event, and this script asks the worker to open it in
// the background — she stays on Brand Watch while the scan runs beside it.
// The version on the document is how the page knows the Mirror is here at all.

;(() => {
  const { api: ext, sendMessage } = globalThis.__myraBrowser
  let version = '?'
  try { version = ext.runtime.getManifest().version } catch {}
  document.documentElement.dataset.myraMirror = version
  document.addEventListener('myra-mirror-open', () => {
    const url = document.documentElement.dataset.myraOpen
    if (!url || !/^https?:\/\//.test(url)) return
    delete document.documentElement.dataset.myraOpen
    sendMessage({ type: 'openTab', url })
  })
})()
