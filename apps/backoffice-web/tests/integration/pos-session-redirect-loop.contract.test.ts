import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const file=(p:string)=>readFileSync(resolve(process.cwd(),"src",p),"utf8");
const layout=file("app/preview/pos/layout.tsx");
const login=file("app/login/store/page.tsx");

describe("POS login redirect loop recovery",()=>{
  it("redirects only invalid 401 sessions and preserves transient failures in a stable retry screen",()=>{
    expect(layout).toContain("error instanceof PosGuardError && error.status === 401");
    expect(layout).toContain('redirect("/login/store?from=pos-session")');
    expect(layout).toContain('sessionCheckProblem = error instanceof PosGuardError');
    expect(layout).toContain('href="/preview/pos?retry=1"');
    expect(layout).not.toContain("requirePosSession().catch(() => null)");
  });
  it("does not immediately send a login-recovery page to the failed POS route again",()=>{
    expect(login).toContain('new URLSearchParams(window.location.search).get("from") === "pos-session"');
    expect(login).toContain('window.location.replace("/preview/pos")');
  });
  it("preserves database sessions and open shifts instead of logging out other stores",()=>{
    expect(layout).not.toContain('from("pos_sessions").update');
    expect(login).not.toContain('from("pos_sessions").update');
  });
});
