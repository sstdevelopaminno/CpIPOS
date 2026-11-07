import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePosSession: vi.fn(),
  getSupabaseServiceClient: vi.fn()
}));

class PosGuardError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

vi.mock("@/lib/pos-session-guard", () => ({
  PosGuardError,
  requirePosSession: mocks.requirePosSession
}));
vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseServiceClient: mocks.getSupabaseServiceClient
}));
vi.mock("@/lib/server/pre-entry-auth", () => ({
  normalizePreferredLanguage: (raw: string | null | undefined) =>
    raw === "en" || raw === "lo" ? raw : "th"
}));

type StoredProfile = { preferred_language: string };
type Query = {
  select: (columns: string) => Query;
  update: (values: { preferred_language: string; updated_at: string }) => Query;
  eq: (column: string, value: string) => Query;
  maybeSingle: () => Promise<{ data: StoredProfile | null; error: null }>;
};

function createProfileStore() {
  const preferences = new Map<string, string>([
    ["tenant-a:employee-a", "th"],
    ["tenant-a:employee-b", "lo"],
    ["tenant-b:employee-a", "en"]
  ]);
  const writes: Array<{ tenant: string; user: string; language: string }> = [];
  const scopes: Array<{ tenant: string; user: string }> = [];
  const from = vi.fn((table: string) => {
    if (table !== "pos_user_profiles") throw new Error(`unexpected table: ${table}`);
    const filters = new Map<string, string>();
    let patch: { preferred_language: string; updated_at: string } | null = null;
    const query = {} as Query;
    query.select = vi.fn(() => query);
    query.update = vi.fn((values) => {
      patch = values;
      return query;
    });
    query.eq = vi.fn((column, value) => {
      filters.set(column, value);
      return query;
    });
    query.maybeSingle = vi.fn(async () => {
      const tenant = filters.get("tenant_id");
      const user = filters.get("user_id");
      if (!tenant || !user) throw new Error("language profile query must scope tenant and user");
      scopes.push({ tenant, user });
      const key = `${tenant}:${user}`;
      if (patch && preferences.has(key)) {
        preferences.set(key, patch.preferred_language);
        writes.push({ tenant, user, language: patch.preferred_language });
      }
      const language = preferences.get(key);
      return { data: language === undefined ? null : { preferred_language: language }, error: null };
    });
    return query;
  });
  mocks.getSupabaseServiceClient.mockReturnValue({ from });
  return { preferences, writes, scopes, from };
}

function signIn(tenant: string, user: string) {
  mocks.requirePosSession.mockResolvedValue({
    session: { tenant_id: tenant, user_id: user }
  });
}

function languageRequest(language: unknown) {
  return new Request("http://localhost/api/pos/settings/language", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ language })
  });
}

describe("POS language preference is scoped to the signed-in user", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("saves one employee language without changing another employee or another tenant", async () => {
    const store = createProfileStore();
    const { GET, POST } = await import("@/app/api/pos/settings/language/route");

    signIn("tenant-a", "employee-a");
    const update = await POST(languageRequest("en"));
    expect(update.status).toBe(200);
    expect((await update.json()).data.language).toBe("en");

    signIn("tenant-a", "employee-b");
    const colleague = await GET();
    expect((await colleague.json()).data.language).toBe("lo");

    signIn("tenant-b", "employee-a");
    const otherTenant = await GET();
    expect((await otherTenant.json()).data.language).toBe("en");

    signIn("tenant-a", "employee-a");
    const restored = await GET();
    expect((await restored.json()).data.language).toBe("en");
    expect(restored.headers.get("set-cookie")).toContain("pos_lang=en");

    expect(store.writes).toEqual([{ tenant: "tenant-a", user: "employee-a", language: "en" }]);
    expect(store.scopes).toEqual([
      { tenant: "tenant-a", user: "employee-a" },
      { tenant: "tenant-a", user: "employee-b" },
      { tenant: "tenant-b", user: "employee-a" },
      { tenant: "tenant-a", user: "employee-a" }
    ]);
  });

  it("rejects unsupported languages before writing any profile", async () => {
    const store = createProfileStore();
    signIn("tenant-a", "employee-a");
    const { POST } = await import("@/app/api/pos/settings/language/route");

    for (const value of ["EN", "fr", "", null]) {
      const response = await POST(languageRequest(value));
      expect(response.status).toBe(422);
      expect((await response.json()).error.code).toBe("invalid_language");
    }
    expect(store.writes).toEqual([]);
    expect(store.from).not.toHaveBeenCalled();
  });

  it("fails closed for an expired session instead of updating another user", async () => {
    const store = createProfileStore();
    mocks.requirePosSession.mockRejectedValue(
      new PosGuardError("session_expired", "POS session expired", 401)
    );
    const { POST } = await import("@/app/api/pos/settings/language/route");
    const response = await POST(languageRequest("lo"));
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("session_expired");
    expect(store.from).not.toHaveBeenCalled();
    expect(store.writes).toEqual([]);
  });

  it("does not silently create a language profile for a missing employee", async () => {
    const store = createProfileStore();
    signIn("tenant-a", "missing-employee");
    const { POST } = await import("@/app/api/pos/settings/language/route");
    const response = await POST(languageRequest("en"));
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("pos_user_profile_not_found");
    expect(store.writes).toEqual([]);
    expect(store.preferences.has("tenant-a:missing-employee")).toBe(false);
  });
});
