/** Strict client-deliverable Windows document/command policy. */
export type WindowsAgentJob =
  | { kind: "html"; saleReceipt: boolean }
  | { kind: "cash_drawer"; drawer: { kickPin: 0 | 1; pulseOnMs: number; pulseOffMs: number } };

export function resolveWindowsAgentJob(input: {
  printerRole: string;
  printerAssigned: boolean;
  metadata: Record<string, unknown>;
  html: string;
}): WindowsAgentJob | null {
  if (!input.printerAssigned) return null;
  const role = input.printerRole;
  const m = input.metadata;
  if (m.command === "open_cash_drawer") {
    // The server must have authorized and enqueued a command from the
    // drawer controller. Never infer a drawer pulse from receipt text.
    if (role !== "receipt" || m.request_source !== "cash_drawer_controller" ||
        (m.drawer_connection_mode !== "printer-kick" && m.drawer_connection_mode !== "emergency-printer-kick") ||
        m.quarantine_replay_allowed !== false) return null;
    const pin = Number(m.drawer_kick_pin);
    const on = Number(m.drawer_pulse_on_ms);
    const off = Number(m.drawer_pulse_off_ms);
    if (![0, 1].includes(pin) || !Number.isInteger(on) || on < 20 || on > 500 ||
        !Number.isInteger(off) || off < 20 || off > 500) return null;
    return { kind: "cash_drawer", drawer: { kickPin: pin as 0 | 1, pulseOnMs: on, pulseOffMs: off } };
  }
  if (m.command !== undefined && m.command !== null) return null;
  if (!["receipt", "report", "kitchen"].includes(role)) return null;
  const html = input.html.trim();
  if (html.length === 0 || html.length > 250_000 || !/<html\b/i.test(html)) return null;
  // Only an actual POS payment sales receipt shares the receipt-once ledger.
  // A payment notice, shift report or kitchen ticket must not consume that
  // order number, otherwise the subsequent paid receipt would be blocked.
  const saleReceipt = role === "receipt" && m.request_source === "pos_payment" &&
    m.payload_format === "receipt_html_v1";
  return { kind: "html", saleReceipt };
}
