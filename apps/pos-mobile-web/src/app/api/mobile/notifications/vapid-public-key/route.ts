import { ok } from "@/lib/api/response";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const env = getEnv();
  return ok({
    enabled: Boolean(env.WEB_PUSH_PUBLIC_KEY && env.WEB_PUSH_PRIVATE_KEY),
    publicKey: env.WEB_PUSH_PUBLIC_KEY ?? null,
  });
}
