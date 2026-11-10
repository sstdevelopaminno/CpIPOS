// Independent Cloudflare Workers incident notice. This is NOT a POS runtime.
const HTML = "<!doctype html>\n<html lang=\"th\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<meta name=\"robots\" content=\"noindex,nofollow\">\n<title>CpiPOS | ประกาศสถานะบริการ</title>\n<style>\n:root{color-scheme:light;font-family:system-ui,\"Noto Sans Thai\",sans-serif}\n*{box-sizing:border-box}\nbody{margin:0;min-height:100vh;display:grid;place-items:center;background:#f0f6fd;color:#132b49;padding:24px}\nmain{width:min(100%,590px);padding:30px;border-radius:18px;background:white;box-shadow:0 10px 32px #142c4c16;border-top:7px solid #146fbc}\n.brand{font-size:19px;font-weight:800;color:#146fbc}\nh1{font-size:27px;line-height:1.35;margin:20px 0 14px}\np{line-height:1.8;margin:10px 0}\n.notice{border-left:4px solid #e59b28;padding:10px 14px;background:#fff9eb;border-radius:6px}\nfooter{font-size:12px;color:#61758c;margin-top:20px;border-top:1px solid #e5ebf3;padding-top:15px}\n</style>\n</head>\n<body>\n<main>\n<div class=\"brand\">CpiPOS · CUTTING POINT INNOVATION</div>\n<h1>ระบบกำลังประสบปัญหาการให้บริการชั่วคราว</h1>\n<p>ขออภัยในความไม่สะดวก ขณะนี้ทีมงานกำลังดำเนินการกู้คืนระบบ CpiPOS โปรดอย่ากดชำระเงินหรือส่งรายการซ้ำเมื่อระบบไม่ตอบสนอง</p>\n<div class=\"notice\"><strong>คำแนะนำระหว่างระบบขัดข้อง</strong><p>สำหรับร้านค้าที่ต้องดำเนินการขายต่อ ให้บันทึกรายการและหลักฐานการรับเงินด้วยวิธีสำรองที่ร้านกำหนด และตรวจสอบยอดก่อนนำกลับเข้าระบบ</p></div>\n<p lang=\"en\"><strong>Temporary service interruption.</strong> We are working on restoring CpiPOS. Do not repeat payments or order submissions when the system is unresponsive. Keep offline records for later reconciliation.</p>\n<footer>หน้านี้เป็นประกาศสถานะบริการเท่านั้น ไม่ใช่หน้าลงชื่อเข้าใช้ POS และไม่เก็บข้อมูลลูกค้า</footer>\n</main>\n</body>\n</html>";
const BASE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, { status: 405, headers: { ...BASE_HEADERS, Allow: "GET, HEAD" } });
    }
    if (url.pathname === "/health") {
      return new Response(request.method === "HEAD" ? null : JSON.stringify({ service: "CpiPOS incident notice", status: "incident" }), {
        status: 200,
        headers: { ...BASE_HEADERS, "Content-Type": "application/json; charset=utf-8" }
      });
    }
    if (url.pathname !== "/") return new Response(null, { status: 404, headers: BASE_HEADERS });
    return new Response(request.method === "HEAD" ? null : HTML, {
      status: 200,
      headers: { ...BASE_HEADERS, "Content-Type": "text/html; charset=utf-8" }
    });
  }
};
