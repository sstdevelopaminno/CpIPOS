import "server-only";

export class BoundedTimeoutError extends Error {
  code: string;
  timeoutMs: number;

  constructor(code: string, timeoutMs: number) {
    super(`${code} timed out after ${timeoutMs}ms`);
    this.name = "BoundedTimeoutError";
    this.code = code;
    this.timeoutMs = timeoutMs;
  }
}

export function readBoundedTimeoutMs(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export async function withAbortableTimeout<T>(
  operation: (signal: AbortSignal) => PromiseLike<T>,
  timeoutMs: number,
  code: string
): Promise<T> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;

  const operationPromise = Promise.resolve()
    .then(() => operation(controller.signal))
    .then((value) => ({ type: "value" as const, value }))
    .catch((error) => {
      if (timedOut || controller.signal.aborted) throw new BoundedTimeoutError(code, timeoutMs);
      throw error;
    });

  const timeoutPromise = new Promise<{ type: "timeout" }>((resolve) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
      resolve({ type: "timeout" });
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([operationPromise, timeoutPromise]);
    if (result.type === "timeout") throw new BoundedTimeoutError(code, timeoutMs);
    return result.value;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
