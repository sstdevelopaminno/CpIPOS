const buckets=new Map<string,{count:number;resetAt:number}>();
export function checkRateLimit(key:string,limit=12,windowMs=60000){const now=Date.now();const c=buckets.get(key);if(!c||c.resetAt<=now){buckets.set(key,{count:1,resetAt:now+windowMs});return true}c.count+=1;return c.count<=limit}
