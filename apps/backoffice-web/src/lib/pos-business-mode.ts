import type { PosFeatureCode } from "@pos/shared-types";
import { POS_MODE_FEATURES } from "@/lib/pos-feature-map";

export type PosBusinessGroup = "FG" | "FF" | "SD";
export type PosBusinessModeId = "home" | "dine_in" | "delivery" | "buffet_table" | "general_sale";

export type PosBusinessModeDefinition = {
  id: PosBusinessModeId;
  group: PosBusinessGroup;
  labelTh: string;
  labelEn: string;
  requiredFeature: PosFeatureCode | null;
  checkoutBaseMode: "home" | "dine_in" | "delivery" | "buffet_table";
};

export const POS_BUSINESS_MODE_DEFINITIONS: readonly PosBusinessModeDefinition[] = [
  {
    id: "home",
    group: "FG",
    labelTh: "กลับบ้าน",
    labelEn: "Takeaway",
    requiredFeature: null,
    checkoutBaseMode: "home"
  },
  {
    id: "dine_in",
    group: "FG",
    labelTh: "นั่งโต๊ะ",
    labelEn: "Dine-in",
    requiredFeature: POS_MODE_FEATURES.dine_in,
    checkoutBaseMode: "dine_in"
  },
  {
    id: "delivery",
    group: "FG",
    labelTh: "เดลิเวอรี่",
    labelEn: "Delivery",
    requiredFeature: POS_MODE_FEATURES.delivery,
    checkoutBaseMode: "delivery"
  },
  {
    id: "buffet_table",
    group: "FF",
    labelTh: "บุฟเฟต์",
    labelEn: "Buffet",
    requiredFeature: POS_MODE_FEATURES.buffet_table,
    checkoutBaseMode: "buffet_table"
  },
  {
    id: "general_sale",
    group: "SD",
    labelTh: "ขายทั่วไป",
    labelEn: "General Sale",
    requiredFeature: POS_MODE_FEATURES.general_sale,
    checkoutBaseMode: "home"
  }
] as const;

export function getPosBusinessModeDefinition(mode: PosBusinessModeId): PosBusinessModeDefinition {
  const definition = POS_BUSINESS_MODE_DEFINITIONS.find((item) => item.id === mode);
  if (!definition) throw new Error(`Unknown POS business mode: ${mode}`);
  return definition;
}

export function isPosBusinessModeEnabled(mode: PosBusinessModeId, enabledFeatures: Record<string, boolean> | null): boolean {
  const definition = getPosBusinessModeDefinition(mode);
  if (!definition.requiredFeature) return true;
  return enabledFeatures?.[definition.requiredFeature] === true;
}
