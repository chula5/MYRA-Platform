// Runs only on MYRA's /mirror/connect. Reads the member token the page
// rendered for the signed-in member and hands it to the service worker.
;(async () => {
  const token = document.querySelector('meta[name="myra-mirror-token"]')?.content
  const member = document.querySelector('meta[name="myra-mirror-member"]')?.content
  if (!token) return
  const res = await new Promise((r) => chrome.runtime.sendMessage({ type: 'setToken', token, member, apiBase: location.origin }, r))
  const h = document.getElementById('myra-mirror-status')
  const p = document.getElementById('myra-mirror-help')
  if (res?.ok) {
    if (h) h.textContent = `Connected as ${res.member || member}.`
    if (p) p.textContent = 'You can close this tab. Open any brand site — it will already be in your order.'
  } else if (h) {
    h.textContent = 'The extension could not connect.'
    if (p) p.textContent = res?.error || 'Try reloading this page.'
  }
})()
