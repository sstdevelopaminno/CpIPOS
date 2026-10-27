import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ getPrimarySupabaseServiceClient: vi.fn() }));
vi.mock("@/lib/supabase-admin", () => ({
  getPrimarySupabaseServiceClient: mocks.getPrimarySupabaseServiceClient
}));

describe("subscription lifecycle guard in-flight timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    vi.clearAllMocks();
    const globalCache = globalThis as typeof globalThis & {
      __posSubscriptionLifecycleGuardCache?: Map<string, unknown>;
      __posSubscriptionLifecycleGuardInFlight?: Map<string, unknown>;
    };
    globalCache.__posSubscriptionLifecycleGuardCache?.clear();
    globalCache.__posSubscriptionLifecycleGuardInFlight?.clear();
  });

  it("aborts hung database reads and retries rather than caching an infinite pending promise", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const pending = new Promise<never>(() => undefined);
    const query: Record<string, unknown> = {};
    for (const name of ["select", "eq", "order", "limit", "not", "is"]) {
      query[name] = vi.fn(() => query);
    }
    query.abortSignal = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return query;
    });
    query.maybeSingle = vi.fn(() => pending);
    query.returns = vi.fn(() => pending);

    const from = vi.fn(() => query);
    mocks.getPrimarySupabaseServiceClient.mockReturnValue({ from });
    const { loadPosSubscriptionLifecycleGuard } = await import(
      "@/lib/services/pos-subscription-lifecycle-guard-service"
    );

    const first = loadPosSubscriptionLifecycleGuard("tenant-guard-timeout");
    await vi.advanceTimersByTimeAsync(4_001);
    expect(await first).toBeNull();
    expect(from).toHaveBeenCalledTimes(5);
    expect(signals).toHaveLength(5);
    expect(signals.every((signal) => signal.aborted)).toBe(true);

    const retry = loadPosSubscriptionLifecycleGuard("tenant-guard-timeout");
    await vi.advanceTimersByTimeAsync(4_001);
    expect(await retry).toBeNull();
    expect(from).toHaveBeenCalledTimes(10);
  });
});
