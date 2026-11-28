/** Explicit preview + synthetic tenant + dedicated Supabase project. Never allow main. */
const PRODUCTION_PROJECT_REF = "deejlitaivfnsbwqdugy";
export function rwWarehouseUatAllowed(tenantId: string, env: {
  VERCEL_ENV?: string;
  RW_WAREHOUSE_UAT_ENABLED?: string;
  RW_WAREHOUSE_UAT_TENANT_ID?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  RW_WAREHOUSE_UAT_PROJECT_REF?: string;
}): boolean {
  const ref=env.RW_WAREHOUSE_UAT_PROJECT_REF;
  if(env.VERCEL_ENV!=="preview"||env.RW_WAREHOUSE_UAT_ENABLED!=="true"||
    !tenantId||env.RW_WAREHOUSE_UAT_TENANT_ID!==tenantId||
    !ref||!/^[a-z0-9]{20}$/.test(ref)||ref===PRODUCTION_PROJECT_REF) return false;
  try {
    const url=new URL(env.NEXT_PUBLIC_SUPABASE_URL??"");
    return url.origin==="https://"+ref+".supabase.co" && url.pathname==="/" &&
      !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}
