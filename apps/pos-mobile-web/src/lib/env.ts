import { z } from "zod";

export const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  MOBILE_SESSION_SECRET: z.string().min(24),
  MOBILE_SESSION_COOKIE_NAME: z.string().default("sstipos_mobile_session"),
  MOBILE_SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  MOBILE_LOGIN_CONTEXT_TTL_MINUTES: z.coerce.number().positive().default(10),
  AUTH_API_TIMEOUT_MS: z.coerce.number().positive().default(8000),
  RATE_LIMIT_BACKEND: z.string().default("memory"),
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  WEB_PUSH_PUBLIC_KEY: z.string().optional(),
  WEB_PUSH_PRIVATE_KEY: z.string().optional(),
  WEB_PUSH_SUBJECT: z.string().default("mailto:admin@sstipos.local"),
  DEPLOY_NOTIFY_SECRET: z.string().min(24).optional(),
});

export function getEnv() {
  return envSchema.parse(process.env);
}
