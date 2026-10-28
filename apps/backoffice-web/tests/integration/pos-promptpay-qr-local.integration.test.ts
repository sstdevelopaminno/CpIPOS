import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  requirePosSession: vi.fn(),
  getTenantPosCurrencyCode: vi.fn()
}));
vi.mock("@/lib/pos-session-guard", () => ({
  PosGuardError: class PosGuardError extends Error {
    constructor(public code: string, message: string, public status: number) {
      super(message);
    }
  },
  requirePosSession: mocks.requirePosSession
}));
vi.mock("@/lib/server/custom-pos-currency", () => ({
  getTenantPosCurrencyCode: mocks.getTenantPosCurrencyCode
}));

import { buildPromptPayPayload } from "@/lib/payments/promptpay-billing-qr";

function request(phone: string, amount = "265.00") {
  return new Request("http://localhost/api/pos/promptpay-qr-proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: `/${phone}/${amount}` })
  });
}

function crc16(text: string) {
  let crc = 0xffff;
  for (const ch of text) {
    crc ^= ch.charCodeAt(0) << 8;
    for (let n = 0; n < 8; n++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

describe("authenticated Native PromptPay QR", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.requirePosSession.mockResolvedValue({ session: { tenant_id: "tenant-1" } });
    mocks.getTenantPosCurrencyCode.mockResolvedValue("THB");
  });

  it("encodes the exact ฿265.00 in canonical TLV with a valid checksum", () => {
    const payload = buildPromptPayPayload("0812345678", 265);
    expect(payload).not.toBeNull();
    expect(payload).toContain("0016A000000677010111");
    expect(payload).toContain("5406265.00");
    expect(payload).toContain("5303764");
    expect(payload).toContain("5802TH");
    expect(payload!.slice(-4)).toBe(crc16(payload!.slice(0, -4)));
    expect(buildPromptPayPayload("+66812345678", 265)).toBe(payload);
    expect(buildPromptPayPayload("0123456789012", 265)).not.toBeNull();
  });

  it("returns PNG bytes without invoking third-party fetch or confirming any payment", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network must not be used"));
    try {
      const { POST } = await import("@/app/api/pos/promptpay-qr-proxy/route");
      const response = await POST(request("0812345678"));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(response.headers.get("cache-control")).toContain("no-store");
      const data = new Uint8Array(await response.arrayBuffer());
      expect(Array.from(data.slice(0, 8))).toEqual([137,80,78,71,13,10,26,10]);
      expect(data.length).toBeGreaterThan(300);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("rejects unconfigured PromptPay IDs and invalid amounts", async () => {
    const { POST } = await import("@/app/api/pos/promptpay-qr-proxy/route");
    for (const [id, amount] of [["123456789", "265.00"], ["0212345678", "265.00"],
      ["0812345678", "0.00"], ["0812345678", "265.001"], ["0812345678", "10000001"]]) {
      const response = await POST(request(id, amount));
      expect(response.status).toBe(422);
    }
  });

  it("does not issue Thai PromptPay for a LAK tenant", async () => {
    mocks.getTenantPosCurrencyCode.mockResolvedValue("LAK");
    const { POST } = await import("@/app/api/pos/promptpay-qr-proxy/route");
    const response = await POST(request("0812345678"));
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("payment_provider_currency_unsupported");
  });

  it("preserves session guard denial codes rather than disguising them as upstream QR outages", async () => {
    const { PosGuardError } = await import("@/lib/pos-session-guard");
    mocks.requirePosSession.mockRejectedValue(new PosGuardError("session_expired", "Session expired", 401));
    const { POST } = await import("@/app/api/pos/promptpay-qr-proxy/route");
    const response = await POST(request("0812345678"));
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("session_expired");
  });
});
