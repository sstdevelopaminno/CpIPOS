import {describe,expect,it} from "vitest";
import {composeRecyclingBatchReceipts,isRecyclingBatchPaper} from "../../src/lib/printing/recycling-batch-receipt-html";
const receipt=(id:string)=>"<!doctype html><html><head><title>Old title</title><style>.receipt{color:black}</style></head><body><div class='receipt'>"+id+"</div></body></html>";
describe("filtered recycling batch print",()=>{
 it("combines all receipts in order and separates each on print",()=>{
  const docs=Array.from({length:71},(_,i)=>receipt("RCY-"+String(i+1).padStart(4,"0")));
  const html=composeRecyclingBatchReceipts(docs,"a5");
  expect(html).toContain('data-receipt-count="71"');
  expect(html.match(/<section class="batch-receipt">/g)).toHaveLength(71);
  expect(html.indexOf("RCY-0001")).toBeLessThan(html.indexOf("RCY-0071"));
  expect(html).toContain("break-after:page");
  expect(html).toContain("size:A5 portrait");
 });
 it("allows only supported paper sizes and rejects missing templates",()=>{
  for(const paper of ["58","80","a4","a5"])expect(isRecyclingBatchPaper(paper)).toBe(true);
  expect(isRecyclingBatchPaper("auto")).toBe(false);
  expect(()=>composeRecyclingBatchReceipts([],"80")).toThrow();
  expect(()=>composeRecyclingBatchReceipts([receipt("RCY-1"),"error"],"a4")).toThrow();
 });
});
