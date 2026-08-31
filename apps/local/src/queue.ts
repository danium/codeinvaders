export interface QueueResult<T> {
  readonly accepted: boolean;
  readonly dropped: number;
  readonly value?: T;
}

/** Bounded queue: callers can only lose cosmetic work; semantic delivery uses lossless mode. */
export class BoundedQueue<T> {
  private readonly items: T[] = [];
  private droppedCount = 0;
  constructor(readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1)
      throw new RangeError('capacity must be positive');
  }
  get size(): number {
    return this.items.length;
  }
  get dropped(): number {
    return this.droppedCount;
  }
  push(value: T, coalesce?: (existing: T) => boolean): QueueResult<T> {
    if (coalesce) {
      const index = this.items.findIndex(coalesce);
      if (index >= 0) {
        this.items[index] = value;
        return { accepted: true, dropped: 0, value };
      }
    }
    if (this.items.length >= this.capacity) {
      this.items.shift();
      this.droppedCount++;
    }
    this.items.push(value);
    return { accepted: true, dropped: this.droppedCount, value };
  }
  shift(): T | undefined {
    return this.items.shift();
  }
  drain(): T[] {
    const result = this.items.splice(0);
    return result;
  }
  clear(): void {
    this.items.length = 0;
  }
}

export class RateLimiter {
  private readonly timestamps: number[] = [];
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}
  allow(now = Date.now()): boolean {
    while (this.timestamps[0] !== undefined && this.timestamps[0]! <= now - this.windowMs)
      this.timestamps.shift();
    if (this.timestamps.length >= this.limit) return false;
    this.timestamps.push(now);
    return true;
  }
}
