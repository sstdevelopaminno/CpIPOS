// Document time is distinct from the actual time of posting and cash/stock movement.
export function bangkokLocalDateTime(now:Date):string {
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(now);
  const get=(key:string)=>parts.find(p=>p.type===key)?.value??"";
  return get("year")+"-"+get("month")+"-"+get("day")+"T"+get("hour")+":"+get("minute")+":"+get("second");
}
export function parseRecyclingDocumentTime(value:unknown,now:Date):string|null {
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value))return null;
  const normalized=value.length===16?value+":00":value;
  const date=new Date(normalized+"+07:00");
  if(!Number.isFinite(date.getTime())||bangkokLocalDateTime(date)!==normalized||date.getTime()>now.getTime())return null;
  return date.toISOString();
}

/** Document clock only, never a machine, settlement or shift clock. */
export type RecyclingDocumentClock={anchorMs:number;startedMs:number;reason:string};
export function startRecyclingDocumentClock(value:unknown,reason:string,now:Date):RecyclingDocumentClock|null{
 const at=parseRecyclingDocumentTime(value,now);
 const trimmed=reason.trim();
 if(!at||trimmed.length<10||trimmed.length>500||now.getTime()-Date.parse(at)>370*86400000)return null;
 return {anchorMs:Date.parse(at),startedMs:now.getTime(),reason:trimmed};
}
export function recyclingDocumentClockAt(clock:RecyclingDocumentClock,now:Date):string{
 const elapsed=Math.max(0,now.getTime()-clock.startedMs);
 return bangkokLocalDateTime(new Date(Math.min(now.getTime(),clock.anchorMs+elapsed)));
}
