export class AsyncEventQueue<T> {
  private readonly items: T[] = []

  private waiter: (() => void) | null = null

  private done = false

  private error: unknown = null

  push(item: T): void {
    if (this.done) return
    this.items.push(item)
    if (this.waiter) {
      const waiter = this.waiter
      this.waiter = null
      waiter()
    }
  }

  close(): void {
    this.done = true
    if (this.waiter) {
      const waiter = this.waiter
      this.waiter = null
      waiter()
    }
  }

  fail(error: unknown): void {
    this.error = error
    this.close()
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T, void, unknown> {
    while (!this.done || this.items.length > 0) {
      if (this.items.length === 0) {
        await new Promise<void>((resolve) => {
          this.waiter = resolve
        })
        continue
      }

      const nextItem = this.items.shift()
      if (typeof nextItem !== 'undefined') {
        yield nextItem
      }
    }

    if (this.error) {
      throw this.error
    }
  }
}
