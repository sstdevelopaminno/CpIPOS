/** Browser-only paper layout: leave the calibrated Windows/native print path alone.
 * CSS @page cannot combine a fixed width with "auto" height; use the driver
 * media size and constrain the receipt to its nominal width without clipping.
 */
export function recyclingBrowserThermalCss(paper:58|80):string{
 const ink=paper===80?72:45;
 return `<style id="recycling-browser-thermal">
 @page{size:auto;margin:0}
 html,body{box-sizing:border-box;width:100%;max-width:none;min-width:0;margin:0;padding:0;background:white}
 .batch-receipt{box-sizing:border-box;width:${paper}mm;max-width:100%;margin:12px auto;padding:0;border:1px solid #ddd}
 .receipt{box-sizing:border-box;width:${ink}mm;max-width:100%;margin:0 auto;padding:1.2mm 0 2mm}
 @media screen{body:not([data-recycling-batch-ready]){box-sizing:border-box;width:${paper}mm;max-width:100%;margin:12px auto;border:1px solid #ddd}}
 @media print{html,body{width:100%;max-width:none;margin:0;padding:0}.batch-receipt{width:${paper}mm;max-width:100%;margin:0 auto;padding:0;border:0}.receipt{width:${ink}mm;max-width:100%;margin:0 auto}}
 </style>`;
}
