import "server-only";
import { readRequiredEnv } from "@/lib/env";

export const PRIMARY_PROJECT_REF = "deejlitaivfnsbwqdugy";

type JwtPayload = { ref?: unknown; role?: unknown };

function decodeJwtPayload(token: string): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as JwtPayload;
  } catch {
    return null;
  }
}

export function validateControlPlaneEnvironment() {
  const url = readRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = readRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  let projectRef = "";
  try {
    const parsed = new URL(url);
    projectRef = parsed.hostname.split(".")[0] ?? "";
  } catch {
    throw new Error("Invalid NEXT_PUBLIC_SUPABASE_URL");
  }

  if (projectRef !== PRIMARY_PROJECT_REF) {
    throw new Error(`IT Supabase URL points to wrong project: ${projectRef || "unknown"}`);
  }

  const jwt = decodeJwtPayload(serviceRoleKey);
  if (jwt) {
    if (jwt.role !== "service_role") {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY does not have service_role");
    }
    if (typeof jwt.ref === "string" && jwt.ref !== PRIMARY_PROJECT_REF) {
      throw new Error(`SUPABASE_SERVICE_ROLE_KEY points to wrong project: ${jwt.ref}`);
    }
  }

  return { projectRef: PRIMARY_PROJECT_REF };
}
