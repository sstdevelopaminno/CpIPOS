// Only call after the native bridge confirmed acceptance. The same server job
// and attempt ID may be acknowledged twice; never invoke the physical spooler
// again. app.ack_print_job_v2 is idempotent for the same agent/attempt and
// rejects stale or expired leases.
export function isRecoverableWindowsAckError(error:unknown):boolean {
  if(error instanceof TypeError || error instanceof SyntaxError)return true;
  if(error instanceof DOMException && error.name==="AbortError")return true;
  return error instanceof Error && (
    error.message==="windows_agent_unavailable" ||
    error.message==="windows_agent_invalid_response" ||
    /^windows_agent_http_5\d\d$/.test(error.message)
  );
}
export async function confirmWindowsSpoolAck<T>(
  acknowledge:()=>Promise<T>, signal:AbortSignal
):Promise<T>{
  if(signal.aborted)throw new DOMException("Agent stopped","AbortError");
  try { return await acknowledge(); }
  catch(error){
    if(signal.aborted || !isRecoverableWindowsAckError(error))throw error;
    // A single delayed retry of the exact acknowledgement; no new claim or
    // spool. The server still enforces the original attempt lease.
    await new Promise<void>((resolve,reject)=>{
      const finish=()=>{signal.removeEventListener("abort",cancel);resolve();};
      const cancel=()=>{clearTimeout(timer);signal.removeEventListener("abort",cancel);reject(new DOMException("Agent stopped","AbortError"));};
      const timer=setTimeout(finish,1000);
      signal.addEventListener("abort",cancel,{once:true});
      if(signal.aborted)cancel();
    });
    if(signal.aborted)throw new DOMException("Agent stopped","AbortError");
    return acknowledge();
  }
}
