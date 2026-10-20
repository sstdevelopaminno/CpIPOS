/** Constraints for the Optical eye-exam form. Match public.optical_eye_exams.
 * Keep bad readings visible; never silently clamp, round, or reinterpret a prescription.
 */
export const opticalExamNumericFields = [
  "age","pd_mm","right_sph","right_cyl","right_axis","right_add",
  "left_sph","left_cyl","left_axis","left_add"
] as const;
export type OpticalExamNumericField = typeof opticalExamNumericFields[number];

export type OpticalExamFieldError = {
  field: OpticalExamNumericField;
  message: string;
};
const labels:Record<OpticalExamNumericField,string> = {
  age:"อายุ",pd_mm:"PD",
  right_sph:"R — SPH",right_cyl:"R — CYL",right_axis:"R — AX",
  right_add:"R — ADD",left_sph:"L — SPH",left_cyl:"L — CYL",
  left_axis:"L — AX",left_add:"L — ADD"
};
const isHundredth=(value:number)=>Math.abs(value*100-Math.round(value*100))<1e-7;
const isTenth=(value:number)=>Math.abs(value*10-Math.round(value*10))<1e-7;

export function validateOpticalExamNumbers(
  values: Partial<Record<OpticalExamNumericField,unknown>>
): OpticalExamFieldError|null {
  for(const field of opticalExamNumericFields){
    const raw=values[field];
    if(raw===undefined||raw===null||(typeof raw==="string"&&raw.trim()===""))continue;
    const value=typeof raw==="number" ? raw
      : typeof raw==="string" ? Number(raw.trim()) : NaN;
    if(!Number.isFinite(value)){
      return {field,message:"กรุณาระบุ"+labels[field]+"เป็นตัวเลขที่ถูกต้อง"};
    }
    if(field==="age"){
      if(!Number.isInteger(value)||value<0||value>130)
        return {field,message:"อายุต้องเป็นจำนวนเต็มตั้งแต่ 0 ถึง 130 ปี"};
    }else if(field==="pd_mm"){
      if(value<30||value>90||!isTenth(value))
        return {field,message:"PD ต้องอยู่ระหว่าง 30–90 มม. และมีทศนิยมไม่เกิน 1 ตำแหน่ง"};
    }else if(field==="right_axis"||field==="left_axis"){
      if(!Number.isInteger(value)||value<0||value>180)
        return {field,message:"ค่า "+labels[field]+" ต้องเป็นจำนวนเต็มตั้งแต่ 0 ถึง 180 องศา"};
    }else if(Math.abs(value)>9999.99||!isHundredth(value)){
      return {field,message:"ค่า "+labels[field]+" ต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง และมีขนาดไม่เกิน 9,999.99"};
    }
  }
  return null;
}
