/** Route optical receipt printing through the configured branch printer and print-agent queue.
 * This never marks an invoice paid, changes stock, or creates a sales order.
 */
export async function requestOpticalWorkOrderPrint(workOrderId:string):Promise<{queued:number}>{
 const response=await fetch(`/api/pos/optical/work-orders/${encodeURIComponent(workOrderId)}/print`,{
   method:"POST",credentials:"same-origin",
   headers:{"X-Optical-Print-Request":crypto.randomUUID()}
 });
 const payload=await response.json().catch(()=>null) as {
   data?:{queued:number};error?:{message?:string}
 }|null;
 if(!response.ok||!payload?.data)throw new Error(payload?.error?.message??"ส่งพิมพ์ใบสั่งงานไม่สำเร็จ");
 return {queued:payload.data.queued};
}
