/**
 * Minimal per-key async mutex. Used by the in-memory store to serialize
 * balance-mutating operations on a single gift card, mirroring the row-level
 * lock (`SELECT … FOR UPDATE`) that the production Postgres function uses. This
 * is what makes concurrent redemptions safe in the offline/demo/test path.
 */
export class KeyedMutex {
  private tails = new Map<string, Promise<void>>()

  async runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    // The next caller waits on `gate`; queue it as the new tail.
    this.tails.set(
      key,
      previous.then(() => gate),
    )
    // Wait our turn.
    await previous
    try {
      return await fn()
    } finally {
      release()
    }
  }
}
