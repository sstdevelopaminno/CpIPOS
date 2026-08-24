import "server-only";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { readRequiredEnv } from "@/lib/env";

type CookieToSet = { name: string; value: string; options: CookieOptions };

export function getServiceClient() {
  return createClient(
    readRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    readRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

export async function getServerAuthClient() {
  const cookieStore = await cookies();
  return createServerClient(
    readRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    readRequiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (rows: CookieToSet[]) => {
          try {
            for (const row of rows) cookieStore.set(row.name, row.value, row.options);
          } catch {
            // Server Components cannot always mutate cookies; route handlers can.
          }
        }
      }
    }
  );
}
