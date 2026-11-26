import { afterEach, describe, expect, it, vi } from "vitest";
import { withWindowsAgentDeadline } from "../../src/lib/printing/windows-agent-request";

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const cancel = () => reject(new DOMException("aborted", "AbortError"));
    if (signal.aborted) cancel();
    else signal.addEventListener("abort", cancel, { once: true });
  });
}

afterEach(() => vi.useRealTimers());

describe("Windows print agent HTTP recovery", () => {
  it("aborts stalled HTTP operations and allows a later request", async () => {
    vi.useFakeTimers();
    const first = withWindowsAgentDeadline(waitForAbort, undefined, 100);
    const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    await expect(withWindowsAgentDeadline(async () => "ready")).resolves.toBe("ready");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("propagates component unmount without waiting for the request deadline", async () => {
    vi.useFakeTimers();
    const lifetime = new AbortController();
    const request = withWindowsAgentDeadline(waitForAbort, lifetime.signal);
    const rejected = expect(request).rejects.toMatchObject({ name: "AbortError" });
    lifetime.abort();
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never starts a new HTTP request when the component is already stopped", async () => {
    const lifetime = new AbortController();
    lifetime.abort();
    const operation = vi.fn(async () => "ready");
    await expect(withWindowsAgentDeadline(operation, lifetime.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(operation).not.toHaveBeenCalled();
  });

  it("does not retry an ambiguous request automatically", async () => {
    const operation = vi.fn(async () => { throw new Error("lost response"); });
    await expect(withWindowsAgentDeadline(operation)).rejects.toThrow("lost response");
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
