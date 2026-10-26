import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Native settings package gates", () => {
  const cases = [
    ["src/app/api/pos/settings/branches/route.ts", "branch_management"],
    ["src/app/api/pos/settings/devices/route.ts", "mobile_device_enrollment"],
    ["src/app/api/pos/settings/tax/route.ts", "core_pos_sales"],
    ["src/app/api/pos/settings/notifications/route.ts", "qr_table_ordering"],
    ["src/app/api/pos/settings/order-kitchen/route.ts", "qr_table_ordering"]
  ] as const;

  for (const [path, feature] of cases) {
    it(`${path} enforces ${feature} and returns canonical feature gate failures`, () => {
      const source = src(path);
      expect(source).toContain(`requirePosApiFeature(auth, "${feature}")`);
      expect(source).toContain("featureGateFail(error)");
    });
  }
});
