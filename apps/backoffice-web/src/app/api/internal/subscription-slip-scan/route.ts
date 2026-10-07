import { Buffer } from "node:buffer";
import { createHash, timingSafeEqual } from "node:crypto";
import { readEnv } from "@/lib/env";
import { fail, ok } from "@/lib/http";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export const runtime="nodejs";
export const dynamic="force-dynamic";

const BUCKET="subscription-payment-evidence";
const MAX_BYTES=4*1024*1024;
const MODEL=readEnv("POS_SLIP_OCR_MODEL")??"gpt-4.1-mini";
const MIN_CONFIDENCE_RAW=Number(readEnv("POS_SLIP_OCR_MIN_CONFIDENCE")??"0.6");
const MIN_CONFIDENCE=Number.isFinite(MIN_CONFIDENCE_RAW)?Math.min(1,Math.max(0,MIN_CONFIDENCE_RAW)):0.6;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ParsedSlip={
  payer_name:string|null;
  payee_name:string|null;
  payee_account:string|null;
  amount:number|null;
  transfer_datetime:string|null;
  transaction_id:string|null;
  reference_no:string|null;
  confidence:number|null;
};

function expectedToken(){
  const serviceRole=String(readEnv("SUPABASE_SERVICE_ROLE_KEY")??"").trim();
  if(!serviceRole)return"";
  return createHash("sha256")
    .update("cpipos:internal-subscription-slip-scan:v1|")
    .update(serviceRole)
    .digest("hex");
}
function authorized(req:Request){
  const raw=String(req.headers.get("authorization")??"").replace(/^Bearer\s+/i,"").trim();
  const expected=expectedToken();
  if(!raw||!expected)return false;
  const a=Buffer.from(raw),b=Buffer.from(expected);
  return a.length===b.length&&timingSafeEqual(a,b);
}
function text(v:unknown){return typeof v==="string"&&v.trim()?v.trim():null;}
function number(v:unknown){const n=typeof v==="number"?v:Number(v);return Number.isFinite(n)?n:null;}
function normalize(v:string|null|undefined){return String(v??"").toLowerCase().replace(/\s+/g," ").trim();}
function digits(v:string|null|undefined){return String(v??"").replace(/[^\d]/g,"");}
function cents(v:number|null){return v===null?null:Math.round(v*100);}
function mimeFromBytes(buffer:Buffer){
  if(buffer.length>=8&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return"image/png";
  if(buffer.length>=3&&buffer[0]===255&&buffer[1]===216&&buffer[2]===255)return"image/jpeg";
  if(buffer.length>=12&&buffer.subarray(0,4).toString("ascii")==="RIFF"&&buffer.subarray(8,12).toString("ascii")==="WEBP")return"image/webp";
  return null;
}
function parseJson(raw:string){
  const value=raw.trim();
  if(!value)return null;
  try{return JSON.parse(value) as Record<string,unknown>;}catch{
    const start=value.indexOf("{"),end=value.lastIndexOf("}");
    if(start<0||end<=start)return null;
    try{return JSON.parse(value.slice(start,end+1)) as Record<string,unknown>;}catch{return null;}
  }
}
function outputText(payload:unknown){
  const body=payload as {output_text?:string;output?:Array<{content?:Array<{text?:string}>}>};
  if(typeof body.output_text==="string"&&body.output_text.trim())return body.output_text.trim();
  return (body.output??[]).flatMap(x=>x.content??[]).map(x=>x.text??"").filter(Boolean).join("\n").trim();
}
async function parseWithOpenAi(input:{
  bytes:Buffer;mime:string;expectedAmount:number;payeeName:string;account:string;promptpay:string;
}):Promise<ParsedSlip>{
  const key=String(readEnv("OPENAI_API_KEY")??"").trim();
  if(!key)throw new Error("OPENAI_API_KEY is missing");
  const instruction=[
    "Extract fields from this Thai bank transfer slip. Return JSON only.",
    "Keys: payer_name, payee_name, payee_account, amount, transfer_datetime, transaction_id, reference_no, confidence.",
    "amount must be numeric without a currency symbol; confidence must be 0..1; unknown fields must be null.",
    "Do not invent any field that is not visible on the slip.",
    "Expected recipient information is supplied only to help identify the recipient, not to overwrite OCR output.",
    "Expected amount: "+input.expectedAmount.toFixed(2),
    "Expected payee name: "+(input.payeeName||"-"),
    "Expected account: "+(input.account||"-"),
    "Expected PromptPay: "+(input.promptpay||"-")
  ].join("\n");
  const response=await fetch("https://api.openai.com/v1/responses",{
    method:"POST",
    headers:{"content-type":"application/json",authorization:"Bearer "+key},
    body:JSON.stringify({
      model:MODEL,
      input:[{role:"user",content:[
        {type:"input_text",text:instruction},
        {type:"input_image",image_url:"data:"+input.mime+";base64,"+input.bytes.toString("base64")}
      ]}]
    }),
    signal:AbortSignal.timeout(30000)
  });
  const payload=await response.json().catch(()=>null);
  if(!response.ok)throw new Error((payload as {error?:{message?:string}}|null)?.error?.message||"OCR request failed");
  const parsed=parseJson(outputText(payload));
  return{
    payer_name:text(parsed?.payer_name),
    payee_name:text(parsed?.payee_name),
    payee_account:text(parsed?.payee_account),
    amount:number(parsed?.amount),
    transfer_datetime:text(parsed?.transfer_datetime),
    transaction_id:text(parsed?.transaction_id),
    reference_no:text(parsed?.reference_no),
    confidence:number(parsed?.confidence)
  };
}
function checksFor(input:{
  parsed:ParsedSlip;expectedAmount:number;payeeName:string;account:string;promptpay:string;
}){
  const amountMatch=cents(input.parsed.amount)===cents(input.expectedAmount);
  const gotName=normalize(input.parsed.payee_name),expectedName=normalize(input.payeeName);
  const gotAccount=digits(input.parsed.payee_account||input.parsed.payee_name);
  const expectedAccount=digits(input.account),expectedPrompt=digits(input.promptpay);
  const nameMatch=Boolean(expectedName&&gotName&&(gotName.includes(expectedName)||expectedName.includes(gotName)));
  const accountMatch=Boolean(expectedAccount&&gotAccount&&(gotAccount.endsWith(expectedAccount)||expectedAccount.endsWith(gotAccount)));
  const promptMatch=Boolean(expectedPrompt&&gotAccount&&(gotAccount.endsWith(expectedPrompt)||expectedPrompt.endsWith(gotAccount)));
  const hasRecipientExpectation=Boolean(expectedName||expectedAccount||expectedPrompt);
  const payeeMatch=hasRecipientExpectation&&(nameMatch||accountMatch||promptMatch);
  const datetimePresent=Boolean(input.parsed.transfer_datetime);
  const confidencePass=input.parsed.confidence!==null&&input.parsed.confidence>=MIN_CONFIDENCE;
  const referencePresent=Boolean(input.parsed.reference_no||input.parsed.transaction_id);
  const issues:string[]=[];
  if(!amountMatch)issues.push("amount_mismatch:"+(input.parsed.amount??"missing"));
  if(!payeeMatch)issues.push("payee_mismatch");
  if(!datetimePresent)issues.push("transfer_datetime_missing");
  if(!confidencePass)issues.push("ocr_confidence_low");
  if(!referencePresent)issues.push("transaction_reference_missing");
  return{
    amount_match:amountMatch,
    payee_match:payeeMatch,
    datetime_present:datetimePresent,
    confidence_pass:confidencePass,
    reference_present:referencePresent,
    passed:issues.length===0,
    issues
  };
}

export async function POST(req:Request){
  if(!authorized(req))return fail("unauthorized","Unauthorized internal request.",401);
  try{
    const body=await req.json().catch(()=>null) as Record<string,unknown>|null;
    const tenantId=String(body?.tenant_id??"").trim();
    const requestId=String(body?.request_id??"").trim();
    const storagePath=String(body?.storage_path??"").trim();
    const expectedAmount=Number(body?.expected_amount??0);
    const payeeName=String(body?.expected_payee_name??"").trim();
    const account=String(body?.expected_account_number??"").trim();
    const promptpay=String(body?.expected_promptpay_id??"").trim();
    if(!UUID.test(tenantId)||!UUID.test(requestId))return fail("invalid_scope","Invalid tenant/request id.",422);
    if(!storagePath.startsWith(tenantId+"/"+requestId+"/"))return fail("invalid_storage_path","Slip path is outside request scope.",422);
    if(!Number.isFinite(expectedAmount)||expectedAmount<=0)return fail("invalid_expected_amount","Expected amount is required.",422);

    const db=getSupabaseServiceClient();
    const downloaded=await db.storage.from(BUCKET).download(storagePath);
    if(downloaded.error||!downloaded.data)return fail("slip_download_failed","Unable to load payment slip.",503);
    const bytes=Buffer.from(await downloaded.data.arrayBuffer());
    if(bytes.length<=0||bytes.length>MAX_BYTES)return fail("slip_size_invalid","Invalid slip size.",422);
    const mime=mimeFromBytes(bytes);
    if(!mime)return fail("slip_type_invalid","Unsupported slip image.",422);

    const parsed=await parseWithOpenAi({bytes,mime,expectedAmount,payeeName,account,promptpay});
    const checks=checksFor({parsed,expectedAmount,payeeName,account,promptpay});
    const scan={
      status:checks.passed?"verified" as const:"needs_review" as const,
      parsed,
      checks,
      model:MODEL,
      error_message:null
    };
    return ok({scan});
  }catch(error){
    const message=error instanceof Error?error.message:"Subscription slip scan failed.";
    return ok({
      scan:{
        status:"error",
        parsed:{payer_name:null,payee_name:null,payee_account:null,amount:null,transfer_datetime:null,transaction_id:null,reference_no:null,confidence:null},
        checks:{amount_match:null,payee_match:false,datetime_present:false,confidence_pass:false,reference_present:false,passed:false,issues:[message]},
        model:MODEL,
        error_message:message
      }
    });
  }
}
