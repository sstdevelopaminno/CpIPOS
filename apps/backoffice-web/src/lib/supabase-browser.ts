import { createBrowserClient } from "@supabase/ssr";

function browserEnv(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/(?:\\r\\n|\\n|\\r)+$/g, "").trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function getSupabaseBrowserClient() {
  // NEXT_PUBLIC_* values must be referenced statically so Next.js can inline
  // them into the browser bundle. Dynamic process.env[name] access is not safe
  // for client-side code.
  const url = browserEnv(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = browserEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  if (!url || !anonKey) {
    throw new Error("Missing Supabase public environment variables.");
  }

  return createBrowserClient(url, anonKey);
}
