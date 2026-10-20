/** Compact printable Code 128-B SVG. Locator only, never payment authorization.
 * Module widths follow ISO/IEC 15417 Code 128 pattern table.
 */
const patterns=[
"212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
"221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
"221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
"212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
"231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
"231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
"314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
"112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
"111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
"214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
"114131","311141","411131","211412","211214","211232","2331112"
] as const;

export function opticalCode128Svg(value:string):string {
 if(!value||value.length>60||![...value].every(ch=>{const cp=ch.charCodeAt(0);return cp>=32&&cp<=126;}))
   throw new Error("optical_barcode_invalid_text");
 const symbols=[104,...[...value].map(x=>x.charCodeAt(0)-32)];
 let checksum=104;
 for(let i=1;i<symbols.length;i++)checksum+=symbols[i]*i;
 symbols.push(checksum%103,106);
 const height=65, quiet=12;let pos=quiet;const rects:string[]=[];
 for(const symbol of symbols){
   const pattern=patterns[symbol];
   for(let i=0;i<pattern.length;i++){
     const width=Number(pattern[i]);
     if(i%2===0)rects.push(`<rect x="${pos}" y="0" width="${width}" height="${height}"/>`);
     pos+=width;
   }
 }
 const width=pos+quiet;
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Code 128 barcode"><rect width="${width}" height="${height}" fill="white"/><g fill="black">${rects.join("")}</g></svg>`;
}
