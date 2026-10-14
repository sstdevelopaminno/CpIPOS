import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { loginFlowText } from "@/lib/pre-entry-language";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("POS sign-in localization", () => {
  const store = source("../../src/app/login/store/page.tsx");
  const employee = source("../../src/app/login/employee/page.tsx");
  const branches = source("../../src/app/login/branches/page.tsx");
  const devices = source("../../src/app/login/devices/page-content.tsx");
  const client = source("../../src/lib/app-language-client.ts");

  it("translates store-code labels, placeholder, login action and error popup to Lao", () => {
    expect(store).toContain('if (lang === "lo")');
    expect(store).toContain('storeCodeLabel: "ລະຫັດຮ້ານຄ້າ"');
    expect(store).toContain('storeCodePlaceholder: "ປ້ອນລະຫັດຮ້ານຄ້າ"');
    expect(store).toContain('submit: "ເຂົ້າລະບົບ"');
    expect(store).toContain('failedTitle: "ເຂົ້າລະບົບບໍ່ສຳເລັດ"');
    expect(store).toContain("<AppLanguageSwitcher lang={lang} onChange={setLanguage} />");
  });

  it("keeps Lao employee code and Owner PIN flow in the same locale", () => {
    expect(employee).toContain('if (lang === "lo")');
    expect(employee).toContain('verifyLabel: "ລະຫັດພະນັກງານ"');
    expect(employee).toContain('pinRequired: "ກະລຸນາປ້ອນ Owner / Manager PIN ເພື່ອສືບຕໍ່"');
  });

  it("translates branch and device select stages while preserving names", () => {
    expect(branches).toContain('T("ເລືອກສາຂາ")'.replace("ເລືອກສາຂາ","เลือกสาขา"));
    expect(devices).toContain('T("เลือกเครื่องแคชเชียร์")');
    expect(loginFlowText("lo","เลือกสาขา")).toBe("ເລືອກສາຂາ");
    expect(loginFlowText("en","เลือกเครื่องแคชเชียร์")).toBe("Select cashier terminal");
    expect(loginFlowText("th","เลือกสาขา")).toBe("เลือกสาขา");
    expect(loginFlowText("lo","My Store")).toBe("My Store");
  });

  it("uses one persistent POS language across login and sales pages", () => {
    expect(client).toContain('window.localStorage.getItem("pos_lang")');
    expect(client).toContain('window.localStorage.setItem("pos_lang", lang)');
    expect(client).toContain("persistLanguageOnClient(preferred)");
    expect(client).not.toContain("persistLanguageOnClient(lang);\n  }, [lang]");
  });
});
