// Bounded-parallel map: runs `fn` over `items` with at most `limit` in flight,
// preserving input order in the settled results. Pure; no I/O of its own.

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const n = Math.max(1, Math.floor(limit))
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (true) {
      const i = next++
      if (i >= items.length) return
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i], i) }
      } catch (reason) {
        results[i] = { status: 'rejected', reason }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
  return results
}
