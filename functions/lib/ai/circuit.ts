/**
 * Per-provider circuit breaker. After `threshold` consecutive failures the circuit opens and the
 * provider is skipped for `cooldownMs`; then exactly one trial request (probe) is allowed (half-open) while
 * concurrent requests keep skipping the provider until the probe finishes (or its slot expires after `cooldownMs`). A success
 * closes it again. State is per Worker isolate (best effort, no storage writes).
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private probeStartedAt: number | null = null;

  constructor(
    private readonly threshold = 3,
    private readonly cooldownMs = 60_000,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /** True if a request may go to the provider. In half-open state this claims the single probe slot. */
  canRequest(): boolean {
    if (this.openedAt === null) return true;
    const now = this.clock();
    if (now - this.openedAt < this.cooldownMs) return false;
    if (this.probeStartedAt !== null && now - this.probeStartedAt < this.cooldownMs) return false; // a probe is in flight
    this.probeStartedAt = now;
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
    this.probeStartedAt = null;
  }

  /** The provider answered but refused for its rate limit: not a failure, but a claimed probe slot is freed. */
  releaseProbe(): void {
    this.probeStartedAt = null;
  }

  recordFailure(): void {
    this.failures++;
    this.probeStartedAt = null;
    if (this.failures >= this.threshold) this.openedAt = this.clock();
  }

  get state(): "closed" | "open" | "half-open" {
    if (this.openedAt === null) return "closed";
    return this.clock() - this.openedAt >= this.cooldownMs ? "half-open" : "open";
  }
}

const breakers = new Map<string, CircuitBreaker>();
export function breakerFor(name: string): CircuitBreaker {
  let b = breakers.get(name);
  if (!b) {
    b = new CircuitBreaker();
    breakers.set(name, b);
  }
  return b;
}
export function resetBreakersForTests(): void {
  breakers.clear();
}
