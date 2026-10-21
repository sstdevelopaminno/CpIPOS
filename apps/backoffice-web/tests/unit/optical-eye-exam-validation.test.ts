import {describe,expect,it} from "vitest";
import {validateOpticalExamNumbers} from "@/lib/optical/optical-eye-exam-validation";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";

describe("Optical prescription values match database CHECK constraints",()=>{
 it("rejects a left AX of 388 before calling the database",()=>{
  expect(validateOpticalExamNumbers({left_axis:"388"})).toEqual({
   field:"left_axis",message:"ค่า L — AX ต้องเป็นจำนวนเต็มตั้งแต่ 0 ถึง 180 องศา"
  });
 });
 it("rejects invalid axis values for both eyes, including non-integers",()=>{
  for(const value of [-1,181,180.5,388,NaN,Infinity]){
   expect(validateOpticalExamNumbers({right_axis:value})?.field).toBe("right_axis");
   expect(validateOpticalExamNumbers({left_axis:value})?.field).toBe("left_axis");
  }
 });
 it("allows true limits and missing optional measurements",()=>{
  expect(validateOpticalExamNumbers({right_axis:"180",left_axis:"0",pd_mm:"56",age:"35"})).toBeNull();
  expect(validateOpticalExamNumbers({left_axis:"",right_axis:null})).toBeNull();
 });
 it("validates database age, PD precision and prescription number scale",()=>{
  expect(validateOpticalExamNumbers({age:"35.5"})?.field).toBe("age");
  expect(validateOpticalExamNumbers({pd_mm:"91"})?.field).toBe("pd_mm");
  expect(validateOpticalExamNumbers({pd_mm:"56.55"})?.field).toBe("pd_mm");
  expect(validateOpticalExamNumbers({right_sph:"12.345"})?.field).toBe("right_sph");
 });
 it("blocks invalid input on the POS form and API without changing SQL constraints",()=>{
  const modal=readFileSync(resolve(process.cwd(),"src/components/pos/pos-optical-customer-modal.tsx"),"utf8");
  const api=readFileSync(resolve(process.cwd(),"src/app/api/pos/optical/customers/route.ts"),"utf8");
  expect(modal).toContain("validateOpticalExamNumbers(fields)");
  expect(modal).toContain('aria-invalid={fieldError===key}');
  expect(api).toContain("validateOpticalExamNumbers(input)");
  expect(api).toContain('invalid.message,422');
  expect(api).toContain('supabase.rpc("optical_save_customer_exam"');
 });
});
