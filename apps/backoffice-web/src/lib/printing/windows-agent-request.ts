// Bound HTTP operations, never the physical spool operation. Abort does not
// prove that the server did not lease/acknowledge a job.
export const WINDOWS_AGENT_REQUEST_TIMEOUT_MS = 12_000;

export async function withWindowsAgentDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  lifetime?: AbortSignal,
  timeoutMs = WINDOWS_AGENT_REQUEST_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (lifetime?.aborted) cancel();
  else lifetime?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, timeoutMs);
  try {
    if (controller.signal.aborted) throw new DOMException("Agent request aborted", "AbortError");
    const result = await operation(controller.signal);
    if (controller.signal.aborted) throw new DOMException("Agent request aborted", "AbortError");
    return result;
  } finally {
    clearTimeout(timer);
    lifetime?.removeEventListener("abort", cancel);
  }
}
