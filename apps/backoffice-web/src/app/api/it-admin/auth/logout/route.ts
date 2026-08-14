import { ok } from "@/lib/http";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export async function POST() {
  const supabase = await getSupabaseServerClient();
  await supabase.auth.signOut();
  const response = ok({ signed_out: true });
  response.headers.set("cache-control", "no-store");
  return response;
}
