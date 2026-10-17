// On Vercel waitUntil lets a request return while its scan runs on. A script
// has no request to return from: collect the work so the script can await it.
const pending = []
module.exports = {
  waitUntil(p) { pending.push(Promise.resolve(p).catch(() => undefined)) },
  async flush() { const all = pending.splice(0); await Promise.all(all) },
}
