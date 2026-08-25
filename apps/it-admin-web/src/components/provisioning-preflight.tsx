"use client";

import { useState, type FormEvent } from "react";

type PackageOption = { code: string; name: string; max_branches: number; max_devices: number | null };
type Check = { key: string; label: string; ok: boolean; detail: string };
type Result = {
  ready: boolean;
  mode: string;
  checks: Check[];
  errors?: string[];
  normalized?: Record<string, unknown>;
  package?: { code: string; name: string; max_branches: number; max_devices: number | null } | null;
  writes_performed?: number;
};

export function ProvisioningPreflight({ packages }: { packages: PackageOption[] }) {
  const [productProfile, setProductProfile] = useState("BUFFET");
  const [storeCode, setStoreCode] = useState("FF0001");
  const [tenantCode, setTenantCode] = useState("FF0001");
  const [tenantName, setTenantName] = useState("");
  const [branchCode, setBranchCode] = useState("");
  const [branchName, setBranchName] = useState("");
  const [packageCode, setPackageCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  function switchProduct(next: string) {
    setProductProfile(next);
    if (next === "BUFFET" && /^FG\d{4}$/i.test(storeCode)) {
      setStoreCode("FF0001");
      setTenantCode("FF0001");
    }
    if (next === "RESTAURANT_QR" && /^FF\d{4}$/i.test(storeCode)) {
      setStoreCode("FG0004");
      setTenantCode("FG0004");
    }
    setResult(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const response = await fetch("/api/provisioning/preflight", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          product_profile: productProfile,
          store_code: storeCode,
          tenant_code: tenantCode,
          tenant_name: tenantName,
          branch_code: branchCode,
          branch_name: branchName,
          package_code: packageCode
        }),
        cache: "no-store"
      });
      const payload = (await response.json()) as Result & { error?: string; detail?: unknown };
      if (!response.ok) throw new Error(payload.error ?? "Preflight failed");
      setResult(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preflight failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="provisionGrid">
      <form className="surface provisionForm" onSubmit={submit}>
        <div className="sectionHeader"><div><h2>New Store Preflight</h2><p>ตรวจ collision และ policy ก่อน provisioning จริง</p></div><span className="badge badgeInfo">DRY RUN</span></div>

        <div className="fieldGrid">
          <label className="field fieldWide">Product profile
            <select value={productProfile} onChange={(e) => switchProduct(e.target.value)}>
              <option value="BUFFET">Buffet — FF####</option>
              <option value="RESTAURANT_QR">Restaurant QR — FG####</option>
            </select>
          </label>
          <label className="field">Store code<input value={storeCode} onChange={(e) => setStoreCode(e.target.value.toUpperCase())} placeholder="FF0001" required /></label>
          <label className="field">Tenant code<input value={tenantCode} onChange={(e) => setTenantCode(e.target.value.toUpperCase())} placeholder="FF0001" required /></label>
          <label className="field fieldWide">ชื่อร้าน<input value={tenantName} onChange={(e) => setTenantName(e.target.value)} placeholder="ชื่อร้าน" required /></label>
          <label className="field">Branch code<input value={branchCode} onChange={(e) => setBranchCode(e.target.value.toUpperCase())} placeholder="FF0001-BKK-01" required /></label>
          <label className="field">ชื่อสาขา<input value={branchName} onChange={(e) => setBranchName(e.target.value)} placeholder="ชื่อสาขา" required /></label>
          <label className="field fieldWide">Package
            <select value={packageCode} onChange={(e) => setPackageCode(e.target.value)} required>
              <option value="">เลือก Package</option>
              {packages.map((pkg) => <option key={pkg.code} value={pkg.code}>{pkg.name} · {pkg.max_branches} branch · {pkg.max_devices ?? "∞"} devices</option>)}
            </select>
          </label>
        </div>

        {error ? <div className="error">{error}</div> : null}
        <div className="actionRow"><button className="primaryButton" type="submit" disabled={loading}>{loading ? "กำลังตรวจ Preflight..." : "ตรวจ Provisioning Preflight"}</button><span className="formSafety">ไม่มีการ INSERT / UPDATE / DELETE</span></div>
      </form>

      <section className="surface resultPanel">
        <div className="sectionHeader"><div><h2>Preflight Result</h2><p>ทุกข้อจะต้อง PASS ก่อนเปิดขั้น Provision</p></div>{result ? <span className={`badge ${result.ready ? "badgeOk" : "badgeDanger"}`}><span className="statusDot" />{result.ready ? "READY" : "BLOCKED"}</span> : <span className="badge">WAITING</span>}</div>
        {!result ? <div className="empty">กรอกข้อมูลร้านแล้วกดตรวจ Preflight</div> : <>
          <div className="checkList">{result.checks.map((check) => <div className={`checkRow ${check.ok ? "checkOk" : "checkFail"}`} key={check.key}><span className="checkIcon">{check.ok ? "✓" : "!"}</span><div><strong>{check.label}</strong><small>{check.detail}</small></div></div>)}</div>
          <div className="notice"><span>◈</span><div><strong>Writes performed: {result.writes_performed ?? 0}</strong><br/>Initial target state: PROVISIONING / tenant inactive / branch inactive / update ring PILOT</div></div>
        </>}
      </section>
    </div>
  );
}
