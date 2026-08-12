import { fail } from "@/lib/http";
import { resolveSessionCookieConfig } from "@/lib/server/pos-session";

type ErrorContext = Record<string, string | number | boolean | null | undefined>;

type PosGuardLikeError = Error & {
  code?: unknown;
  status?: unknown;
};

function errorSummary(error: unknown) {
  if (!(error instanceof Error)) return { name: "UnknownError", message: String(error) };
  return {
    name: error.name,
    message: error.message
  };
}

function readPosGuardError(error: unknown): { code: string; status: number; message: string } | null {
  if (!(error instanceof Error) || error.name !== "PosGuardError") return null;

  const candidate = error as PosGuardLikeError;
  const code = typeof candidate.code === "string" && candidate.code.trim() ? candidate.code.trim() : null;
  const status = typeof candidate.status === "number" && Number.isInteger(candidate.status) ? candidate.status : null;
  if (!code || !status || status < 400 || status > 599) return null;

  let message = error.message || "POS session validation failed.";
  if (code === "session_expired") {
    message = "เซสชัน POS หมดอายุ กรุณาเข้าสู่ระบบใหม่ แล้วลองอีกครั้ง";
  } else if (code === "session_not_active") {
    message = "เซสชัน POS ไม่พร้อมใช้งาน กรุณาเข้าสู่ระบบใหม่ แล้วลองอีกครั้ง";
  }

  return { code, status, message };
}

function clearStalePosSessionCookies(response: Response) {
  const config = resolveSessionCookieConfig();
  const attributes = [
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Lax",
    config.secure ? "Secure" : null,
    config.domain ? `Domain=${config.domain}` : null
  ].filter((value): value is string => Boolean(value));

  response.headers.append("Set-Cookie", `${config.name}=; ${attributes.join("; ")}`);
  response.headers.append("Set-Cookie", `${config.sessionIdName}=; ${attributes.join("; ")}`);
  response.headers.set("x-pos-session-cleared", "1");
}

export function loggedPrintApiFail(
  scope: string,
  error: unknown,
  code: string,
  message: string,
  status = 500,
  context: ErrorContext = {}
) {
  const requestId = crypto.randomUUID();
  console.error(`[print-api] ${scope}`, {
    request_id: requestId,
    error: errorSummary(error),
    ...context
  });

  const posGuard = readPosGuardError(error);
  if (posGuard) {
    const response = fail(posGuard.code, `${posGuard.message} Reference: ${requestId}`, posGuard.status);
    response.headers.set("x-request-id", requestId);
    if (posGuard.status === 401) {
      clearStalePosSessionCookies(response);
    }
    return response;
  }

  const response = fail(code, `${message} Reference: ${requestId}`, status);
  response.headers.set("x-request-id", requestId);
  return response;
}
