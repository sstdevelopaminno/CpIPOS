/** Validate configured store image references before embedding in HTML. No server-side fetch. */
export function expenseVoucherLogoUrl(raw:unknown):string {
  if(typeof raw!=="string")return "";
  const value=raw.trim();
  if(!value||value.length>220000||/[\u0000-\u001f\u007f]/.test(value))return "";
  if(/^data:image\/(?:png|jpeg|jpg|webp|gif|bmp|avif|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/i.test(value))return value;
  if(value.startsWith("/")&&!value.startsWith("//")&&!value.includes("\\"))return value;
  try {
    const url=new URL(value);
    return (url.protocol==="https:"||url.protocol==="http:")&&!url.username&&!url.password?url.href:"";
  }catch{return "";}
}
