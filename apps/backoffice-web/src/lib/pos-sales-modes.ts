export const POS_SALES_MODE_KEYS = ["takeaway", "dine_in", "buffet_table", "delivery", "general_sale"] as const;

export type PosSalesModeKey = (typeof POS_SALES_MODE_KEYS)[number];
export type PosSalesModeSettings = Record<PosSalesModeKey, boolean>;

export const DEFAULT_POS_SALES_MODES: PosSalesModeSettings = {
  takeaway: true,
  dine_in: true,
  buffet_table: true,
  delivery: true,
  general_sale: true
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizePosSalesModes(value: unknown): PosSalesModeSettings {
  const record = asRecord(value);
  return {
    takeaway: asBoolean(record.takeaway, asBoolean(record.home, DEFAULT_POS_SALES_MODES.takeaway)),
    dine_in: asBoolean(record.dine_in, DEFAULT_POS_SALES_MODES.dine_in),
    buffet_table: asBoolean(record.buffet_table, DEFAULT_POS_SALES_MODES.buffet_table),
    delivery: asBoolean(record.delivery, DEFAULT_POS_SALES_MODES.delivery),
    general_sale: asBoolean(record.general_sale, DEFAULT_POS_SALES_MODES.general_sale)
  };
}

export function posUiModeToControlKey(value: string | null | undefined): PosSalesModeKey | null {
  if (value === "home" || value === "takeaway") return "takeaway";
  if (value === "dine_in") return "dine_in";
  if (value === "buffet_table") return "buffet_table";
  if (value === "delivery") return "delivery";
  if (value === "general_sale") return "general_sale";
  return null;
}
