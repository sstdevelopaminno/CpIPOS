export const POS_SALES_MODE_KEYS = ["takeaway", "dine_in", "buffet_table", "delivery", "general_sale", "optical_retail"] as const;

export type PosSalesModeKey = (typeof POS_SALES_MODE_KEYS)[number];
export type PosSalesModeSettings = Record<PosSalesModeKey, boolean>;

export const DEFAULT_POS_SALES_MODES: PosSalesModeSettings = {
  takeaway: true,
  dine_in: true,
  buffet_table: true,
  delivery: true,
  general_sale: true,
  optical_retail: false
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
    general_sale: asBoolean(record.general_sale, DEFAULT_POS_SALES_MODES.general_sale),
    optical_retail: asBoolean(record.optical_retail, DEFAULT_POS_SALES_MODES.optical_retail)
  };
}

/** CUSTOM never silently enables sales modes omitted by the IT contract. */
export function normalizeCustomPosSalesModes(value: unknown): PosSalesModeSettings {
  const record = asRecord(value);
  return Object.fromEntries(
    POS_SALES_MODE_KEYS.map((key) => [key, record[key] === true])
  ) as PosSalesModeSettings;
}

/**
 * The POS and IT must use the same sales-mode entitlement decision.
 * Explicit customer/IT selections take precedence over package defaults;
 * defaults only apply before a selection exists. Never fill missing flags
 * with true: a partial/legacy contract must not unlock an unselected mode.
 */
export function resolvePosSalesModePolicy(
  contractMetadata: Record<string, unknown>,
  packageMetadata: Record<string, unknown> | null | undefined
): PosSalesModeSettings {
  const raw = contractMetadata.sales_modes;
  const explicit = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown> : null;
  const packageDefaults = Array.isArray(packageMetadata?.default_sales_modes)
    ? packageMetadata.default_sales_modes.filter((mode): mode is PosSalesModeKey =>
        typeof mode === "string" && (POS_SALES_MODE_KEYS as readonly string[]).includes(mode))
    : [];
  const modes = normalizeCustomPosSalesModes(explicit ?? Object.fromEntries(
    packageDefaults.map((key) => [key, true])
  ));
  const rawLimit = Number(packageMetadata?.sales_mode_limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(POS_SALES_MODE_KEYS.length, Math.trunc(rawLimit))
    : null;
  if (limit === null || POS_SALES_MODE_KEYS.filter((key) => modes[key]).length <= limit) return modes;
  // For older invalid contracts, do not invent or enable different modes.
  // Preserve explicit IT selections in canonical order; new IT writes reject overflow.
  const allowed = new Set(POS_SALES_MODE_KEYS.filter((key) => modes[key]).slice(0, limit));
  return Object.fromEntries(POS_SALES_MODE_KEYS.map((key) => [
    key, allowed.has(key)
  ])) as PosSalesModeSettings;
}

export function posUiModeToControlKey(value: string | null | undefined): PosSalesModeKey | null {
  if (value === "home" || value === "takeaway") return "takeaway";
  if (value === "dine_in") return "dine_in";
  if (value === "buffet_table") return "buffet_table";
  if (value === "delivery") return "delivery";
  if (value === "general_sale") return "general_sale";
  if (value === "optical_retail") return "optical_retail";
  return null;
}


export const DINE_IN_LINKED_FEATURE_CODES = [
  "table_management",
  "kitchen_printing",
  "qr_table_ordering"
] as const;

export function isDineInLinkedFeature(featureCode: string): boolean {
  return (DINE_IN_LINKED_FEATURE_CODES as readonly string[]).includes(String(featureCode ?? "").trim());
}

export function isDineInExplicitlyEnabled(value: unknown): boolean {
  const record = asRecord(value);
  return record.dine_in === true;
}

/** IT's per-tenant CUSTOM grant is the authoritative Optical mode entitlement.
 * Do not require the generic core_pos_sales feature: a CUSTOM package can
 * explicitly grant Optical without including the ordinary takeaway package feature.
 * UI visibility is not server payment authorization; transactional endpoints must
 * still separately check the POS session and their own access controls.
 */
export function isAuthorizedOpticalRetailMode(snapshot: {
  is_custom?: boolean;
  is_internal_test_full?: boolean;
  sales_modes?: unknown;
} | null | undefined): boolean {
  if (!snapshot || !(snapshot.is_custom === true || snapshot.is_internal_test_full === true)) return false;
  return normalizeCustomPosSalesModes(snapshot.sales_modes).optical_retail === true;
}

/** A CUSTOM package grants cashier access only when IT explicitly activates a
 * supported sales mode in the effective contract. No implicit package access.
 */
export function isCustomCashierModeEnabled(rawSalesModes: unknown): boolean {
  const modes = normalizeCustomPosSalesModes(rawSalesModes);
  return modes.general_sale || modes.optical_retail;
}

/** Optical checkout reuses the general retail scanner only when explicitly enabled by IT. */
export function isOpticalRetailExplicitlyEnabled(value: unknown): boolean {
  return asRecord(value).optical_retail === true;
}
