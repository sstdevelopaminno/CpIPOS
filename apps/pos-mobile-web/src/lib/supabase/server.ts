import "server-only";import {createClient} from "@supabase/supabase-js";import {getEnv} from "@/lib/env";
export function createServiceClient(){const e=getEnv();return createClient(e.NEXT_PUBLIC_SUPABASE_URL,e.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})}
