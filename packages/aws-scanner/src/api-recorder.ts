/**
 * Counts AWS API calls and throttles during a scan so the orchestrator can
 * populate scan stats and the observability metrics.
 */
export class ApiCallRecorder {
  private calls = 0;
  private throttles = 0;
  private readonly perService = new Map<
    string,
    { calls: number; throttles: number }
  >();

  recordCall(service: string): void {
    this.calls += 1;
    this.bucket(service).calls += 1;
  }

  recordThrottle(service: string): void {
    this.throttles += 1;
    this.bucket(service).throttles += 1;
  }

  private bucket(service: string): { calls: number; throttles: number } {
    let entry = this.perService.get(service);
    if (!entry) {
      entry = { calls: 0, throttles: 0 };
      this.perService.set(service, entry);
    }
    return entry;
  }

  get totalCalls(): number {
    return this.calls;
  }

  get totalThrottles(): number {
    return this.throttles;
  }

  snapshot(): {
    calls: number;
    throttles: number;
    perService: Record<string, { calls: number; throttles: number }>;
  } {
    return {
      calls: this.calls,
      throttles: this.throttles,
      perService: Object.fromEntries(this.perService),
    };
  }
}
