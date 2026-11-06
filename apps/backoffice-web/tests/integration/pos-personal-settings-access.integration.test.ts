import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
const shell = read("../../src/components/pos-preview/pos-shell-sidebar.tsx");
const settingsPage = read("../../src/app/preview/pos/settings/page.tsx");
const personalSettings = read("../../src/components/pos-preview/pos-personal-settings.tsx");

describe("POS personal settings role access", () => {
  it("shows the Settings entry to staff and kitchen without granting accountant access", () => {
    expect(shell).toContain('sessionRole === "staff" || sessionRole === "kitchen"');
    expect(shell).toContain("showAdvancedMenus");
    expect(shell).toContain("isPersonalSettingsRole");
  });

  it("routes staff and kitchen to limited personal settings before full settings permission checks", () => {
    const limitedBranch = settingsPage.indexOf('sessionRole === "staff" || sessionRole === "kitchen"');
    const fullPermission = settingsPage.indexOf('requirePosPagePermission("settings:view")');
    expect(limitedBranch).toBeGreaterThan(-1);
    expect(fullPermission).toBeGreaterThan(limitedBranch);
    expect(settingsPage).toContain("<PosPersonalSettings");
    expect(settingsPage).toContain('sessionRole === "kitchen" && printersEnabled');
  });

  it("keeps language changes user-scoped through the authenticated language API", () => {
    expect(personalSettings).toContain('fetch("/api/pos/settings/language"');
    expect(personalSettings).toContain("setLanguage(nextLanguage)");
    expect(personalSettings).toContain("languageEnabled");
  });
});
