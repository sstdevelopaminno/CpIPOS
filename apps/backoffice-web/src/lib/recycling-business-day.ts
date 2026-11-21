/** Fixed official Thailand business-day boundary. This never follows a device's timezone. */
export const RECYCLING_BUSINESS_TIME_ZONE="Asia/Bangkok" as const;
export function recyclingBusinessDayKey(value:Date):string{
 if(!Number.isFinite(value.getTime()))return "";
 const parts=new Intl.DateTimeFormat("en-US",{
  timeZone:RECYCLING_BUSINESS_TIME_ZONE,year:"numeric",month:"2-digit",day:"2-digit"
 }).formatToParts(value);
 const field=(key:string)=>parts.find(part=>part.type===key)?.value??"";
 return field("year")+"-"+field("month")+"-"+field("day");
}
export function recyclingShiftIsToday(openedAt:string,now:Date=new Date()):boolean{
 const date=new Date(openedAt);
 return Boolean(openedAt && recyclingBusinessDayKey(date) &&
  recyclingBusinessDayKey(date)===recyclingBusinessDayKey(now));
}
