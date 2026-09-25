import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const route = readFileSync(resolve(process.cwd(), "src/app/api/pos/users/route.ts"), "utf8");
const ui = readFileSync(resolve(process.cwd(), "src/components/pos/pos-users-module.tsx"), "utf8");

describe("IT-managed first Owner account", () => {
  it("checks the explicit canonical owner ID in GET, PATCH, POST and DELETE", () => {
    expect(route).toContain('select("primary_owner_user_id")');
    expect(route).toContain("protectedOwnerId");
    expect(route).toContain("is_protected_primary_owner");
    expect(route.match(/await isItProtectedPrimaryOwner\(auth\.tenantId!, userId\)/g)).toHaveLength(2);
    expect(route).toContain("existingProfile?.id && await isItProtectedPrimaryOwner");
    expect(route).toContain("row.user_id !== protectedOwnerId && canActorEditTarget");
    expect(route).toContain("row.user_id !== protectedOwnerId && canActorDelete");
  });
  it("lets only the store Owner manage manager and staff users; only IT can appoint Owners", () => {
    expect(route).toContain('return actorRole === "owner";');
    expect(route).toContain('requestedRole === "owner") return fail("owner_role_it_only"');
    expect(ui).toContain('role !== "owner" || (Boolean(form.user_id) && form.role === "owner")');
    expect(ui).toContain("disabled={!item.can_edit}");
  });
});
