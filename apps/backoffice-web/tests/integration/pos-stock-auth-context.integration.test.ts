import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

function makeRequest(input: {
  path: string;
  referer: string;
  cookie: string;
}) {
  return new NextRequest(`https://cpipos.test${input.path}`, {
    headers: {
      referer: input.referer,
      cookie: input.cookie
    }
  });
}

describe("POS stock Backoffice auth compatibility", () => {
  it("removes Supabase auth cookies only from a POS catalog request that has a POS session", async () => {
    const request = makeRequest({
      path: "/api/backoffice/catalog?view=ingredients",
      referer: "https://cpipos.test/preview/pos/stock",
      cookie: "pos_session_id=pos-session-1; sb-demo-auth-token=supabase-session; cpipos_other=keep-me"
    });

    const response = await proxy(request);

    expect(response.status).toBe(200);
    expect(request.cookies.get("pos_session_id")?.value).toBe("pos-session-1");
    expect(request.cookies.get("sb-demo-auth-token")).toBeUndefined();
    expect(request.cookies.get("cpipos_other")?.value).toBe("keep-me");
  });

  it("preserves Supabase auth cookies for the same API outside the POS surface", async () => {
    const request = makeRequest({
      path: "/api/backoffice/catalog",
      referer: "https://cpipos.test/it-admin",
      cookie: "pos_session_id=stale-pos-session; sb-demo-auth-token=supabase-session"
    });

    const response = await proxy(request);

    expect(response.status).toBe(200);
    expect(request.cookies.get("sb-demo-auth-token")?.value).toBe("supabase-session");
  });

  it("preserves Supabase auth when a POS stock-settings request has no POS session", async () => {
    const request = makeRequest({
      path: "/api/backoffice/stock/settings",
      referer: "https://cpipos.test/preview/pos/stock",
      cookie: "sb-demo-auth-token=supabase-session"
    });

    const response = await proxy(request);

    expect(response.status).toBe(200);
    expect(request.cookies.get("sb-demo-auth-token")?.value).toBe("supabase-session");
  });
});
