/** Matches the original POS product-media source, canvas and byte limits. */
export type MaterialPhoto = {
 display:{blob:Blob;size:number;extension:"webp"|"jpg"};
 thumbnail:{blob:Blob;size:number;extension:"webp"|"jpg"};
};
const MIME=new Set(["image/jpeg","image/png","image/webp"]);
function loadImage(file:File):Promise<HTMLImageElement>{
 return new Promise((resolve,reject)=>{
  const url=URL.createObjectURL(file),img=new Image();
  img.onload=()=>{URL.revokeObjectURL(url);resolve(img)};
  img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error("ไม่สามารถอ่านไฟล์รูปภาพได้"))};
  img.src=url;
 });
}
function canvasBlob(canvas:HTMLCanvasElement,type:"image/webp"|"image/jpeg",quality:number):Promise<Blob>{
 return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob&&blob.size>0?resolve(blob):reject(new Error("image_encode_failed")),type,quality));
}
async function render(image:HTMLImageElement,max:number,webpQuality:number,jpegQuality:number){
 const w=image.naturalWidth||image.width,h=image.naturalHeight||image.height;
 const crop=Math.min(w,h);
 if(!crop||!Number.isFinite(crop))throw new Error("รูปภาพไม่มีขนาดที่รองรับ");
 const size=Math.min(max,Math.max(320,crop)),canvas=document.createElement("canvas");
 canvas.width=size;canvas.height=size;
 const ctx=canvas.getContext("2d",{alpha:false});
 if(!ctx)throw new Error("อุปกรณ์นี้ไม่รองรับการย่อภาพ");
 ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";
 ctx.fillStyle="#ffffff";ctx.fillRect(0,0,size,size);
 ctx.drawImage(image,(w-crop)/2,(h-crop)/2,crop,crop,0,0,size,size);
 try{
  const blob=await canvasBlob(canvas,"image/webp",webpQuality);
  if(blob.type==="image/webp")return {blob,size,extension:"webp" as const};
 }catch{/* WebP encoding unavailable on some Android WebViews. */}
 const blob=await canvasBlob(canvas,"image/jpeg",jpegQuality);
 if(blob.type!=="image/jpeg")throw new Error("ไม่สามารถแปลงเป็น JPG ได้");
 return {blob,size,extension:"jpg" as const};
}
export async function optimizeRecyclingMaterialImage(file:File):Promise<MaterialPhoto>{
 if(!MIME.has(file.type))throw new Error("รองรับเฉพาะ JPG, PNG, WebP");
 if(file.size<=0||file.size>20*1024*1024)throw new Error("ไฟล์ต้นฉบับต้องไม่เกิน 20 MB");
 const img=await loadImage(file);
 const [display,thumbnail]=await Promise.all([render(img,1200,0.82,0.86),render(img,400,0.76,0.80)]);
 if(display.blob.size>1_572_864||thumbnail.blob.size>524_288)
  throw new Error("ไฟล์ที่ย่อแล้วยังเกิน 1.5 MB / 512 KB กรุณาใช้รูปที่เล็กลง");
 return {display,thumbnail};
}
