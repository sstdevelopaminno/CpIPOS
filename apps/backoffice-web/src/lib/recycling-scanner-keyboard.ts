/**
 * Dedicated Recycling scanner field: Thai Kedmanee HID keyboard output is
 * decoded to the physical US-QWERTY barcode. Do not change the OS language.
 * Free-text material-name search is a SEPARATE mode and is never transliterated.
 */
const rows = [
  ["1234567890-=", "ๅ/-ภถุึคตจขช"],
  ["qwertyuiop[]\\", "ๆไำพะัีรนยบลฃ"],
  ["asdfghjkl;'", "ฟหกดเ้่าสวง"],
  ["zxcvbnm,./", "ผปแอิืทมใฝ"]
] as const;
const thaiToPhysical = new Map<string,string>();
for(const [latin,thai] of rows){
  Array.from(thai).forEach((char,index)=>thaiToPhysical.set(char,latin[index]));
}

export function normalizeRecyclingBarcodeInput(text:string):string{
  return Array.from(text).map(char=>thaiToPhysical.get(char)??char).join("");
}

const codeToUs:Record<string,[string,string]>={
  Minus:["-","_"],Equal:["=","+"],BracketLeft:["[","{"],BracketRight:["]","}"],
  Backslash:["\\","|"],Semicolon:[";",":"],Quote:["'",'"'],Comma:[",","<"],
  Period:[".",">"],Slash:["/","?"],Backquote:["`","~"]
};

/** null means let the browser handle the key; only HID layout keys are mapped. */
export function physicalRecyclingBarcodeKey(code:string,shift:boolean):string|null{
  if(/^Key[A-Z]$/.test(code)){
    const letter=code.slice(3);
    return shift?letter:letter.toLowerCase();
  }
  if(/^Digit[0-9]$/.test(code)){
    const digit=code.slice(5);
    return shift?"!@#$%^&*()"[Number(digit)===0?9:Number(digit)-1]:digit;
  }
  if(/^Numpad[0-9]$/.test(code)) return code.slice(6);
  if(code==="NumpadDecimal")return ".";
  if(code==="NumpadSubtract")return "-";
  if(code==="NumpadAdd")return "+";
  if(code==="NumpadDivide")return "/";
  if(code==="NumpadMultiply")return "*";
  const pair=codeToUs[code];
  return pair?pair[shift?1:0]:null;
}
