import "server-only";
import QRCode from "qrcode";

// Thai PromptPay EMV merchant-presented QR. ID comes from trusted billing
// settings or from the authenticated POS payment-account workflow.
const tlv = (id: string, value: string) => id + String(value.length).padStart(2, "0") + value;

function checksum(payload: string) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Reuse one deterministic, bank-standard EMV payload for POS and IT billing. */
export function buildPromptPayPayload(promptPayId: string, amount: number): string | null {
  const original = promptPayId.replace(/\D/g, "");
  // Cashier payment settings may hold a +66 Thai mobile number.
  const id = original.length === 11 && original.startsWith("66")
    ? "0" + original.slice(2)
    : original;
  const branch = /^0[689]\d{8}$/.test(id)
    ? tlv("01", "0066" + id.slice(1))
    : /^\d{13}$/.test(id) ? tlv("02", id)
    : /^\d{15}$/.test(id) ? tlv("03", id)
    : null;

  if (!branch || !Number.isFinite(amount) || amount <= 0 || amount > 10_000_000 ||
      Math.round(amount * 100) / 100 !== amount) return null;

  const value = tlv("00", "01") + tlv("01", "12") +
    tlv("29", tlv("00", "A000000677010111") + branch) +
    tlv("52", "0000") + tlv("53", "764") + tlv("54", amount.toFixed(2)) +
    tlv("58", "TH") + "6304";
  return value + checksum(value);
}

export async function generateBillingPromptPayQr(promptPayId: string, amount: number) {
  const payload = buildPromptPayPayload(promptPayId, amount);
  if (!payload) return null;
  return QRCode.toDataURL(payload, { width: 260, margin: 2, errorCorrectionLevel: "M" });
}
