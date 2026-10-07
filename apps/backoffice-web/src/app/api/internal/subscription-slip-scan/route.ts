import { Buffer } from "node:buffer";
import { createHash,timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { readEnv } from "@/lib/env";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";

export const runtime="nodejs";
export const dynamic="force-dynamic";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUCKET="subscription-payment-evidence";
const MAX_BYTES=4*1024*1024;
const OCR_MODEL=readEnv("POS_SLIP_OCR_MODEL")??"gpt-4.1-mini";
const CONFIDENCE=Math.min(1,Math.max(0,Number(readEnv("POS_SLIP_OCR_MIN_CONFIDENCE")??"0.6")||0.6));

type Parsed={
  payer_name:string|null;payee_name:string|null;payee_account:string|null;amount:number|null;
  transfer_datetime:string|null;transaction_id:string|null;reference_no:string|null;confidence:number|null;
};
type Body={
  tenant_id?:unknown;request_id?:unknown;storage_path?:unknown;expected_amount?:unknown;
  expected_payee_name?:unknown;expected_account_number?:unknown;expected_promptpay_id?:unknown;
};
function reply(status:number,payload:Record<string,unknown>){
  return NextResponse.json(payload,{status,headers:{"cache-control":"no-store","x-content-type-options":"nosniff"}});
}
function serviceRole(){return String(readEnv("SUPABASE_SERVICE_ROLE_KEY")??"").trim();}
function expectedBridgeToken(){
  const key=serviceRole();if(!key)return"";
  return createHash("sha256").update("cpipos:internal-subscription-slip-scan:v1|").update(key).digest("hex");
}
function authorized(req:Request){
  const raw=String(req.headers.get("authorization")??"").replace(/^Bearer\s+/i,"").trim();
  const expected=expectedBridgeToken();if(!raw||!expected)return false;
  const a=Buffer.from(raw),b=Buffer.from(expected);
  return a.length===b.length&&timingSafeEqual(a,b);
}
function str(v:unknown,max=500){return String(v??"").trim().slice(0,max);}
function num(v:unknown){const n=Number(v);return Number.isFinite(n)?n:null;}
function digits(v:unknown){return str(v,180).replace(/[^\d]/g,"");}
function norm(v:unknown){return str(v,240).toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").replace(/\s+/g," ").trim();}
function cents(v:number|null){return v===null?null:Math.round(v*100);}
function suffixMatch(a:string,b:string){
  const x=digits(a),y=digits(b);if(!x||!y)return false;
  if(x===y||x.includes(y)||y.includes(x))return true;
  return x.length>=4&&y.length>=4&&x.slice(-4)===y.slice(-4);
}
function asString(v:unknown){return typeof v==="string"&&v.trim()?v.trim():null;}
function asNumber(v:unknown){const n=typeof v==="number"?v:typeof v==="string"?Number(v):NaN;return Number.isFinite(n)?n:null;}
function parseJson(raw:string){
  const t=raw.trim();if(!t)return null;
  try{const x=JSON.parse(t);return x&&typeof x==="object"?x as Record<string,unknown>:null;}catch{}
  const a=t.indexOf("{"),z=t.lastIndexOf("}");if(a<0||z<=a)return null;
  try{const x=JSON.parse(t.slice(a,z+1));return x&&typeof x==="object"?x as Record<string,unknown>:null;}catch{return null;}
}
function outputText(payload:unknown){
  const body=payload as {output_text?:string;output?:Array<{content?:Array<{text?:string}>}>};
  if(typeof body.output_text==="string"&&body.output_text.trim())return body.output_text;
  return (body.output??[]).flatMap(x=>x.content??[]).map(x=>x.text??"").filter(Boolean).join("\n").trim();
}
function normalizeParsed(x:Record<string,unknown>|null):Parsed{
  return {
    payer_name:asString(x?.payer_name),payee_name:asString(x?.payee_name),payee_account:asString(x?.payee_account),
    amount:asNumber(x?.amount),transfer_datetime:asString(x?.transfer_datetime),
    transaction_id:asString(x?.transaction_id),reference_no:asString(x?.reference_no),confidence:asNumber(x?.confidence)
  };
}
function mimeFromBytes(bytes:Uint8Array){
  if(bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return"image/jpeg";
  if(bytes.length>=8&&bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47)return"image/png";
  if(bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==="RIFF"&&String.fromCharCode(...bytes.slice(8,12))==="WEBP")return"image/webp";
  return"";
}
async function parseSlip(input:{bytes:Uint8Array;mime:string;expectedAmount:number;payeeName:string;account:string;promptpay:string}):Promise<Parsed>{
  const apiKey=readEnv("OPENAI_API_KEY");
  if(!apiKey)throw new Error("slip_scanner_not_configured");
  const instruction=[
    "Read this Thai bank transfer slip and extract only fields visibly present on the slip.",
    "Return only JSON with keys: payer_name, payee_name, payee_account, amount, transfer_datetime, transaction_id, reference_no, confidence.",
    "Do not invent or infer missing values. Use null when a value is not visible.",
    "amount must be numeric with satang preserved. confidence must be 0..1.",
    "The expected values below are for validation context only; never copy them into extracted fields unless actually visible.",
    "Expected amount: "+input.expectedAmount.toFixed(2),
    "Expected payee name: "+(input.payeeName||"-"),
    "Expected bank account: "+(input.account||"-"),
    "Expected PromptPay ID: "+(input.promptpay||"-")
  ].join("\n");
  const response=await fetch("https://api.openai.com/v1/responses",{
    method:"POST",
    headers:{"content-type":"application/json",authorization:"Bearer "+apiKey},
    body:JSON.stringify({model:OCR_MODEL,input:[{role:"user",content:[
      {type:"input_text",text:instruction},
      {type:"input_image",image_url:"data:"+input.mime+";base64,"+Buffer.from(input.bytes).toString("base64")}
    ]}]})
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error("slip_scanner_provider_failed");
  return normalizeParsed(parseJson(outputText(payload)));
}
function checks(parsed:Parsed,expectedAmount:number,payeeName:string,account:string,promptpay:string){
  const amountMatch=cents(parsed.amount)===cents(expectedAmount);
  const expectedName=norm(payeeName),parsedName=norm(parsed.payee_name);
  const nameMatch=Boolean(expectedName&&parsedName&&(parsedName.includes(expectedName)||expectedName.includes(parsedName)));
  const accountMatch=suffixMatch(account,parsed.payee_account??"");
  const promptpayMatch=suffixMatch(promptpay,parsed.payee_account??"")||suffixMatch(promptpay,parsed.payee_name??"");
  const hasRecipient=Boolean(expectedName||digits(account)||digits(promptpay));
  const payeeMatch=hasRecipient&&(nameMatch||accountMatch||promptpayMatch);
  const datetimePresent=Boolean(parsed.transfer_datetime);
  const confidencePass=parsed.confidence!==null&&parsed.confidence>=CONFIDENCE;
  const referencePresent=Boolean(parsed.transaction_id||parsed.reference_no);
  const issues:string[]=[];
  if(!amountMatch)issues.push("amount_mismatch");
  if(!payeeMatch)issues.push("payee_mismatch");
  if(!datetimePresent)issues.push("transfer_datetime_missing");
  if(!referencePresent)issues.push("transaction_reference_missing");
  if(!confidencePass)issues.push("confidence_low");
  return {amount_match:amountMatch,payee_match:payeeMatch,datetime_present:datetimePresent,confidence_pass:confidencePass,reference_present:referencePresent,passed:issues.length===0,issues};
}

export async function POST(req:Request){
  if(!authorized(req))return reply(401,{error:{code:"unauthorized",message:"Internal bridge authorization required."}});
  try{
    const body=await req.json().catch(()=>null) as Body|null;
    const tenantId=str(body?.tenant_id,64),requestId=str(body?.request_id,64),storagePath=str(body?.storage_path,500);
    if(!UUID.test(tenantId)||!UUID.test(requestId))return reply(422,{error:{code:"invalid_scope",message:"Invalid tenant/request scope."}});
    const expectedPrefix=tenantId+"/"+requestId+"/";
    if(!storagePath.startsWith(expectedPrefix)||storagePath.includes(".."))return reply(422,{error:{code:"invalid_storage_path",message:"Evidence path is outside request scope."}});

    const db=getPrimarySupabaseServiceClient();
    const [requestResult,dueResult,settingsResult]=await Promise.all([
      db.from("tenant_subscription_payment_requests")
        .select("id,tenant_id,status,evidence_url,metadata")
        .eq("id",requestId).eq("tenant_id",tenantId).maybeSingle<Record<string,unknown>>(),
      db.rpc("subscription_billing_due_state",{p_tenant_id:tenantId}),
      db.from("it_communication_settings")
        .select("billing_bank_account_name,billing_bank_account_number,billing_promptpay_id")
        .eq("id","default").maybeSingle<Record<string,unknown>>()
    ]);
    if(requestResult.error||!requestResult.data)return reply(404,{error:{code:"payment_request_not_found",message:"Payment request was not found."}});
    if(dueResult.error||!dueResult.data)return reply(503,{error:{code:"billing_state_unavailable",message:"Billing state is unavailable."}});
    if(settingsResult.error||!settingsResult.data)return reply(503,{error:{code:"payment_account_unavailable",message:"Payment account is unavailable."}});
    if(String(requestResult.data.evidence_url??"")!==storagePath)return reply(409,{error:{code:"evidence_path_mismatch",message:"Evidence path does not match payment request."}});
    if(!["pending","under_review"].includes(String(requestResult.data.status??"")))return reply(409,{error:{code:"payment_request_not_reviewable",message:"Payment request is not reviewable."}});

    const metadata=(requestResult.data.metadata&&typeof requestResult.data.metadata==="object"&&!Array.isArray(requestResult.data.metadata)?requestResult.data.metadata:{}) as Record<string,unknown>;
    const due=(dueResult.data??{}) as Record<string,unknown>;
    const metadataExpected=num(metadata.expected_amount);
    const dueExpected=num(due.outstanding)??num(due.amount_due);
    const callerExpected=num(body?.expected_amount);
    const expectedAmount=metadataExpected??dueExpected;
    if(expectedAmount===null||expectedAmount<=0)return reply(409,{error:{code:"expected_amount_unavailable",message:"Expected billing amount is unavailable."}});
    if(callerExpected!==null&&cents(callerExpected)!==cents(expectedAmount))return reply(409,{error:{code:"expected_amount_mismatch",message:"Caller amount does not match billing control plane."}});

    const payeeName=str(settingsResult.data.billing_bank_account_name,180);
    const account=str(settingsResult.data.billing_bank_account_number,80);
    const promptpay=str(settingsResult.data.billing_promptpay_id,80);
    if(!payeeName&&!digits(account)&&!digits(promptpay))return reply(503,{error:{code:"payment_recipient_unconfigured",message:"Billing recipient is not configured."}});

    const downloaded=await db.storage.from(BUCKET).download(storagePath);
    if(downloaded.error||!downloaded.data)return reply(404,{error:{code:"slip_not_found",message:"Payment evidence was not found."}});
    if(downloaded.data.size<=0||downloaded.data.size>MAX_BYTES)return reply(422,{error:{code:"invalid_slip_size",message:"Slip image must be <= 4 MB."}});
    const bytes=new Uint8Array(await downloaded.data.arrayBuffer());
    const mime=mimeFromBytes(bytes);
    if(!mime)return reply(422,{error:{code:"invalid_slip_image",message:"Slip must be JPEG, PNG, or WebP."}});

    let parsed:Parsed;
    try{parsed=await parseSlip({bytes,mime,expectedAmount,payeeName,account,promptpay});}
    catch(error){
      return reply(200,{data:{scan:{status:"error",parsed:{},checks:{amount_match:false,payee_match:false,datetime_present:false,confidence_pass:false,reference_present:false,passed:false,issues:["scan_unavailable"]},model:OCR_MODEL,error_message:error instanceof Error?error.message:"scan_unavailable"}}});
    }
    const verification=checks(parsed,expectedAmount,payeeName,account,promptpay);
    return reply(200,{data:{scan:{status:verification.passed?"verified":"needs_review",parsed,checks:verification,model:OCR_MODEL,error_message:null}}});
  }catch(error){
    console.error("[subscription-slip-scan]",error instanceof Error?error.message:"unknown");
    return reply(500,{error:{code:"subscription_slip_scan_failed",message:"Unable to scan subscription slip."}});
  }
}
