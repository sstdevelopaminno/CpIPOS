import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { readRequiredEnv } from "@/lib/env";

export async function getSupabaseServerClient() {
  const cookieStore = await cookies();
  const url = readRequiredEnv("NEXT_PUBLIC_SUPABASE_URL", "Missing Supabase public environment variables.");
  const anonKey = readRequiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "Missing Supabase public environment variables.");

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components may read cookies but cannot write them. The app
          // proxy refreshes Supabase auth for Control Plane requests and writes
          // the rotated cookies to the HTTP response before rendering begins.
          // Route Handlers / Server Actions still write successfully here.
        }
      }
    }
  });
}
