export const TABLE_ORDER_CONTENTION_MAX_ATTEMPTS = 3;

function parseRetryAfterSeconds(value: string | null | undefined) {
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export function resolveTableOrderContentionRetryMs(args: {
  status: number;
  errorCode?: string | null;
  retryAfter?: string | null;
  attempt: number;
}) {
  if (args.status !== 409 || args.errorCode !== "table_order_busy") return null;
  if (args.attempt >= TABLE_ORDER_CONTENTION_MAX_ATTEMPTS) return null;

  const retryAfterSeconds = parseRetryAfterSeconds(args.retryAfter);
  if (retryAfterSeconds !== null) {
    return Math.max(250, Math.min(1_500, Math.round(retryAfterSeconds * 1_000)));
  }

  return args.attempt <= 1 ? 650 : 1_100;
}
