import "server-only";
import QRCode from "qrcode";

// Thai PromptPay EMV merchant-presented QR. ID comes only from IT billing settings.
const tlv=(id:string,value:string)=>id+String(value.length).padStart(2,"0")+value;
function checksum(payload:string){
  let crc=0xffff;
  for(let i=0;i<payload.length;i++){
    crc^=payload.charCodeAt(i)<<8;
    for(let j=0;j<8;j++)crc=(crc&0x8000)?((crc<<1)^0x1021)&0xffff:(crc<<1)&0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4,"0");
}
export async function generateBillingPromptPayQr(promptPayId:string,amount:number){
  const id=promptPayId.replace(/\D/g,"");
  const branch=id.length===10&&id.startsWith("0")
    ?tlv("01","0066"+id.slice(1))
    :id.length===13?tlv("02",id):id.length===15?tlv("03",id):null;
  if(!branch||!Number.isFinite(amount)||amount<=0||amount>10_000_000)return null;
  const value=tlv("00","01")+tlv("01","12")+
    tlv("29",tlv("00","A000000677010111")+branch)+
    tlv("52","0000")+tlv("53","764")+tlv("54",amount.toFixed(2))+tlv("58","TH")+"6304";
  return QRCode.toDataURL(value+checksum(value),{width:260,margin:2,errorCorrectionLevel:"M"});
}
