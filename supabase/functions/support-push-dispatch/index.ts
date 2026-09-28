import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method_not_allowed",{status:405});
  try {
    const input = await req.json() as {
      audience:"it"|"store"; tenant_id?:string|null; kind?:string;
      title:string; body:string; url:string; tag?:string|null;
    };
    const url=Deno.env.get("SUPABASE_URL")||"";
    const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
    const db=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
    const cfg=await db.from("support_push_config").select("vapid_public_key,vapid_private_key,subject").eq("id","default").single();
    if(cfg.error||!cfg.data) throw new Error("push_config_missing");
    webpush.setVapidDetails(String(cfg.data.subject),String(cfg.data.vapid_public_key),String(cfg.data.vapid_private_key));
    let query=db.from("support_push_subscriptions").select("id,endpoint,p256dh,auth").eq("enabled",true).eq("audience_type",input.audience);
    if(input.audience==="store") query=query.eq("tenant_id",input.tenant_id);
    const rows=await query.limit(500);
    if(rows.error) throw rows.error;
    const payload=JSON.stringify({
      title:input.title||"CpIPOS",body:input.body||"",url:input.url||"/",tag:input.tag||"cpipos-support",
      kind:input.kind||"general",icon:"/brand/cpipos-symbol-sidebar.png",badge:"/icons/cpipos-browser-icon.png"
    });
    let delivered=0;
    for(const row of rows.data??[]){
      try{
        await webpush.sendNotification({endpoint:String(row.endpoint),keys:{p256dh:String(row.p256dh),auth:String(row.auth)}},payload,{TTL:120,urgency:"high"});
        delivered++;
      }catch(error){
        const status=Number((error as {statusCode?:number}).statusCode??0);
        if(status===404||status===410) await db.from("support_push_subscriptions").update({enabled:false,updated_at:new Date().toISOString()}).eq("id",row.id);
      }
    }
    return Response.json({data:{matched:rows.data?.length??0,delivered},error:null});
  }catch(error){
    console.error("[support-push]",error);
    return Response.json({data:null,error:{code:"push_dispatch_failed"}},{status:500});
  }
});
