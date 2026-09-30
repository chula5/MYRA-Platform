// MYRA Mirror — one browser API surface for Chrome and Safari.
//
// Chrome's MV3 APIs use callbacks when we provide one. Safari's Web Extension
// APIs expose the browser namespace and return promises. Keep that difference
// here so the rest of the extension stays one shared source tree.
;(() => {
  const isSafari = typeof browser !== 'undefined'
  const api = isSafari ? browser : chrome

  function sendMessage(message) {
    if (isSafari) return Promise.resolve(api.runtime.sendMessage(message)).catch(() => null)
    return new Promise((resolve) => {
      try {
        api.runtime.sendMessage(message, (response) => {
          resolve(api.runtime.lastError ? null : response)
        })
      } catch {
        resolve(null)
      }
    })
  }

  function onMessage(handler) {
    api.runtime.onMessage.addListener((message, sender, sendResponse) => {
      let result
      try {
        result = handler(message, sender)
      } catch (error) {
        result = Promise.reject(error)
      }

      // Safari expects a promise from an async listener. Chrome expects the
      // listener to keep its callback channel open while the promise settles.
      if (isSafari) return result
      if (result == null || result === false) return false
      if (typeof result.then === 'function') {
        result.then(sendResponse, (error) => sendResponse({ error: String(error?.message || error) }))
        return true
      }
      sendResponse(result)
      return false
    })
  }

  globalThis.__myraBrowser = { api, isSafari, onMessage, sendMessage }
})()
