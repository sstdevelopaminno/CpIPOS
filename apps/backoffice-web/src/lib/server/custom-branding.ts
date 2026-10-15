import "server-only";
import {getSupabaseServiceClient} from "@/lib/supabase-admin";

export const BRAND_COLORS = ["#1453A6","#047857","#7C3AED","#DB2777","#EA580C","#0F766E","#DC2626","#0F172A"] as const;
export type CustomBranding = {system_name:string;accent_color:string;sidebar_color:string;logo_url:string|null};
export const DEFAULT_BRANDING:CustomBranding={
  system_name:"CpiPOS",accent_color:"#1453A6",sidebar_color:"#071B37",logo_url:null
};
const safeColor=(value:unknown,fallback:string)=>
  typeof value==="string" && /^#[0-9a-fA-F]{6}$/.test(value)?value.toUpperCase():fallback;
const safeLogo=(value:unknown)=>{
  if(typeof value!=="string"||value.length>900)return null;
  try {
    const u=new URL(value);
    if(u.protocol!=="https:")return null;
    // only tenant-scoped uploaded content from our dedicated branding bucket
    if(!u.pathname.includes("/storage/v1/object/public/custom-branding/"))return null;
    return u.toString();
  }catch{return null;}
};
export function normalizeCustomBranding(input:unknown):CustomBranding {
  const data=input && typeof input==="object"&&!Array.isArray(input)
    ?input as Record<string,unknown>:{};
  const name=typeof data.system_name==="string"?data.system_name.trim():"";
  return {
    system_name: name.length>=2 && name.length<=55 && !/[<>]/.test(name)?name:DEFAULT_BRANDING.system_name,
    accent_color:safeColor(data.accent_color,DEFAULT_BRANDING.accent_color),
    sidebar_color:safeColor(data.sidebar_color,DEFAULT_BRANDING.sidebar_color),
    logo_url:safeLogo(data.logo_url)
  };
}
export async function requireCustomBrandingTenant(tenantId:string) {
  const db=getSupabaseServiceClient();
  const {data,error}=await db.from("tenant_subscription_contracts")
    .select("package_id,status,ended_at")
    .eq("tenant_id",tenantId).order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(error||!data||!["active","trial"].includes(data.status)||
    (data.ended_at && new Date(data.ended_at).getTime()<=Date.now()))return false;
  const pkg=await db.from("subscription_packages").select("code")
    .eq("id",data.package_id).maybeSingle();
  return !pkg.error && String(pkg.data?.code??"").toLowerCase()==="custom";
}
export async function loadTenantBranding(tenantId:string):Promise<CustomBranding|null>{
  if(!await requireCustomBrandingTenant(tenantId))return null;
  const {data,error}=await getSupabaseServiceClient().from("tenants")
    .select("metadata").eq("id",tenantId).maybeSingle();
  if(error||!data)throw new Error("custom_branding_unavailable");
  const metadata=(data.metadata&&typeof data.metadata==="object")?data.metadata as Record<string,unknown>:{};
  return normalizeCustomBranding(metadata.custom_branding);
}
