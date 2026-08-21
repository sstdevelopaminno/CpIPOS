export type BuffetTableSessionSummary = {
  enabled: boolean;
  per_person_quantity: number;
  set_quantity: number;
  total_quantity: number;
  subtotal: number;
  updated_at: string | null;
};

export const EMPTY_BUFFET_TABLE_SESSION_SUMMARY: BuffetTableSessionSummary = {
  enabled: false,
  per_person_quantity: 0,
  set_quantity: 0,
  total_quantity: 0,
  subtotal: 0,
  updated_at: null
};

function safeQuantity(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.max(0, Math.trunc(parsed));
}

function safeMoney(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Number(parsed.toFixed(2));
}

export function normalizeBuffetTableSessionSummary(metadata: Record<string, unknown> | null | undefined): BuffetTableSessionSummary {
  const raw = metadata?.buffet_session;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...EMPTY_BUFFET_TABLE_SESSION_SUMMARY };
  }

  const value = raw as Record<string, unknown>;
  const perPersonQuantity = safeQuantity(value.per_person_quantity);
  const setQuantity = safeQuantity(value.set_quantity);
  const totalQuantity = perPersonQuantity + setQuantity;
  const subtotal = safeMoney(value.subtotal);
  const updatedAt = typeof value.updated_at === "string" && value.updated_at.trim() ? value.updated_at : null;

  return {
    enabled: value.enabled === true && totalQuantity > 0,
    per_person_quantity: perPersonQuantity,
    set_quantity: setQuantity,
    total_quantity: totalQuantity,
    subtotal,
    updated_at: updatedAt
  };
}

export function mergeBuffetTableSessionSummaryMetadata(
  metadata: Record<string, unknown> | null | undefined,
  summary: BuffetTableSessionSummary
): Record<string, unknown> {
  return {
    ...(metadata ?? {}),
    buffet_session: {
      enabled: summary.enabled,
      per_person_quantity: safeQuantity(summary.per_person_quantity),
      set_quantity: safeQuantity(summary.set_quantity),
      total_quantity: safeQuantity(summary.per_person_quantity) + safeQuantity(summary.set_quantity),
      subtotal: safeMoney(summary.subtotal),
      updated_at: summary.updated_at ?? new Date().toISOString()
    }
  };
}

export function formatBuffetTableSessionLabel(summary: BuffetTableSessionSummary, lang: "th" | "en") {
  const parts: string[] = [];
  if (summary.per_person_quantity > 0) {
    parts.push(lang === "th" ? `${summary.per_person_quantity} ท่าน` : `${summary.per_person_quantity} guest${summary.per_person_quantity === 1 ? "" : "s"}`);
  }
  if (summary.set_quantity > 0) {
    parts.push(lang === "th" ? `${summary.set_quantity} ชุด` : `${summary.set_quantity} set${summary.set_quantity === 1 ? "" : "s"}`);
  }
  if (parts.length === 0) return lang === "th" ? "บุฟเฟ่" : "Buffet";
  return `${lang === "th" ? "บุฟเฟ่" : "Buffet"} ${parts.join(" · ")}`;
}
