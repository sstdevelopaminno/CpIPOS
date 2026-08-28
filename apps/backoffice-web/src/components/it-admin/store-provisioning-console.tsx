"use client";

import { useMemo, useState } from "react";

export type ProvisioningPackageOption = {
  id: string;
  code: string;
  name: string;
  monthly_price: number;
  yearly_price: number;
  max_branches: number;
  max_devices: number;
  max_users: number;
  quota_mode: string;
};

type ProvisioningResult = {
  request_id: string;
  store_code: string;
  tenant: { id: string; name: string };
  branch: { id: string; code: string; name: string };
  package: {
    code: string;
    name: string;
    amount_per_cycle: number;
    billing_interval: string;
    currency: string;
    max_branches: number;
    max_devices: number;
    max_users: number;
  };
  contract: { status: string };
  owner: { user_id: string; name: string; email: string; employee_code: string; role: "owner" };
  activation: { status: "ready_for_device_enrollment"; next_step: "register_device" };
};

type ApiPayload = {
  data: ProvisioningResult | null;
  error: { code: string; message: string } | null;
};

type FormState = {
  storeName: string;
  packageId: string;
  contractStatus: "trial" | "active";
  billingInterval: "monthly" | "yearly";
  branchCode: string;
  branchName: string;
  branchAddress: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  employeeCode: string;
  pin: string;
};

function newRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function money(value: number, currency = "THB") {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency,
    maximumFractionDigits: 0
  }).format(value);
}

export function StoreProvisioningConsole({ packages }: { packages: ProvisioningPackageOption[] }) {
  const standardPackages = useMemo(() => packages.filter((item) => item.quota_mode === "standard"), [packages]);
  const defaultPackage = standardPackages[0] ?? packages[0] ?? null;
  const [requestId, setRequestId] = useState(newRequestId);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [result, setResult] = useState<ProvisioningResult | null>(null);
  const [form, setForm] = useState<FormState>({
    storeName: "",
    packageId: defaultPackage?.id ?? "",
    contractStatus: "trial",
    billingInterval: "monthly",
    branchCode: "001",
    branchName: "สาขาหลัก",
    branchAddress: "",
    ownerName: "",
    ownerEmail: "",
    ownerPhone: "",
    employeeCode: "100001",
    pin: ""
  });

  const selectedPackage = packages.find((item) => item.id === form.packageId) ?? null;
  const billingPrice = form.billingInterval === "yearly" ? selectedPackage?.yearly_price ?? 0 : selectedPackage?.monthly_price ?? 0;
  const packageBlocked = !selectedPackage || selectedPackage.quota_mode !== "standard" || billingPrice <= 0;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || packageBlocked) return;
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/it-admin/v1/store-provisioning", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          request_id: requestId,
          store: {
            name: form.storeName,
            owner_phone: form.ownerPhone || null
          },
          package_id: form.packageId,
          contract: {
            status: form.contractStatus,
            billing_interval: form.billingInterval
          },
          initial_branch: {
            code: form.branchCode,
            name: form.branchName,
            address: form.branchAddress || null
          },
          owner: {
            name: form.ownerName,
            email: form.ownerEmail,
            phone: form.ownerPhone || null,
            employee_code: form.employeeCode,
            pin: form.pin
          }
        })
      });
      const payload = (await response.json().catch(() => null)) as ApiPayload | null;
      if (!response.ok || !payload?.data) {
        setError(payload?.error ?? { code: "store_provisioning_failed", message: "ไม่สามารถเปิดร้านได้ กรุณาลองใหม่ด้วย Request ID เดิม" });
        return;
      }
      setResult(payload.data);
      setForm((current) => ({ ...current, pin: "" }));
    } catch {
      setError({
        code: "store_provisioning_network_failed",
        message: "การเชื่อมต่อขัดข้อง กรุณากดสร้างร้านอีกครั้งโดยใช้ Request ID เดิม ระบบจะไม่สร้างร้านซ้ำ"
      });
    } finally {
      setSubmitting(false);
    }
  }

  function startNextStore() {
    setRequestId(newRequestId());
    setError(null);
    setResult(null);
    setForm({
      storeName: "",
      packageId: defaultPackage?.id ?? "",
      contractStatus: "trial",
      billingInterval: "monthly",
      branchCode: "001",
      branchName: "สาขาหลัก",
      branchAddress: "",
      ownerName: "",
      ownerEmail: "",
      ownerPhone: "",
      employeeCode: "100001",
      pin: ""
    });
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    border: "1px solid #dbe3ee",
    borderRadius: 9,
    padding: "9px 10px",
    fontSize: 13,
    background: "#fff",
    boxSizing: "border-box"
  };
  const labelStyle: React.CSSProperties = { display: "grid", gap: 5, fontSize: 12, color: "#526176", fontWeight: 700 };

  return (
    <section style={{ border: "1px solid #dfe7f1", borderRadius: 14, padding: 18, marginBottom: 22, background: "#fbfdff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: 0 }}>เปิดร้านใหม่ · Store Provisioning</h3>
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "#6d7b8f" }}>
            Tenant → Store Code → Package → สาขา → Owner/PIN → พร้อมลงทะเบียน Device โดยไม่แก้ SQL หรือ source ต่อร้าน
          </p>
        </div>
        <code style={{ fontSize: 10, color: "#718096", overflowWrap: "anywhere" }}>Request {requestId}</code>
      </div>

      {result ? (
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ padding: 16, borderRadius: 12, background: "#edf9f2", border: "1px solid #bfe8ce" }}>
            <strong style={{ color: "#147a43" }}>เปิดร้านสำเร็จ</strong>
            <div style={{ fontSize: 28, fontWeight: 900, marginTop: 6, letterSpacing: 2 }}>{result.store_code}</div>
            <div style={{ fontSize: 12, color: "#486052" }}>Store Code สำหรับลูกค้า · เก็บรหัสนี้ไว้กับร้าน</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
            <div><small>ร้าน</small><br /><strong>{result.tenant.name}</strong></div>
            <div><small>สาขาเริ่มต้น</small><br /><strong>{result.branch.code} · {result.branch.name}</strong></div>
            <div><small>Package</small><br /><strong>{result.package.name} · {money(result.package.amount_per_cycle, result.package.currency)}/{result.package.billing_interval === "monthly" ? "เดือน" : "ปี"}</strong></div>
            <div><small>Owner Login</small><br /><strong>{result.owner.employee_code}</strong><br /><small>{result.owner.email}</small></div>
          </div>
          <div style={{ fontSize: 12, color: "#526176" }}>
            ขั้นถัดไป: <strong>Register Device / Android / Print Agent</strong> · จำกัด {result.package.max_branches} สาขา / {result.package.max_devices} เครื่อง / {result.package.max_users} ผู้ใช้ ตาม Package
          </div>
          <button type="button" onClick={startNextStore} style={{ justifySelf: "start", border: 0, borderRadius: 9, padding: "9px 14px", background: "#246af0", color: "white", fontWeight: 800, cursor: "pointer" }}>
            เปิดร้านถัดไป
          </button>
        </div>
      ) : (
        <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
            <label style={labelStyle}>ชื่อร้าน / บริษัทลูกค้า<input required value={form.storeName} onChange={(e) => update("storeName", e.target.value)} style={inputStyle} /></label>
            <label style={labelStyle}>Package
              <select required value={form.packageId} onChange={(e) => update("packageId", e.target.value)} style={inputStyle}>
                {packages.map((item) => (
                  <option key={item.id} value={item.id} disabled={item.quota_mode !== "standard"}>
                    {item.name} · {item.quota_mode === "standard" ? `${money(item.monthly_price)}/เดือน` : "Custom · ต้องจัดสัญญาเอง"}
                  </option>
                ))}
              </select>
            </label>
            <label style={labelStyle}>สถานะสัญญา
              <select value={form.contractStatus} onChange={(e) => update("contractStatus", e.target.value as FormState["contractStatus"])} style={inputStyle}>
                <option value="trial">Trial</option><option value="active">Active</option>
              </select>
            </label>
            <label style={labelStyle}>รอบบิล
              <select value={form.billingInterval} onChange={(e) => update("billingInterval", e.target.value as FormState["billingInterval"])} style={inputStyle}>
                <option value="monthly">รายเดือน</option>
                <option value="yearly" disabled={(selectedPackage?.yearly_price ?? 0) <= 0}>รายปี</option>
              </select>
            </label>
          </div>

          {selectedPackage ? (
            <div style={{ padding: 10, borderRadius: 9, background: "#f0f5ff", fontSize: 12, color: "#40516a" }}>
              {selectedPackage.name}: {money(billingPrice)} · {selectedPackage.max_branches} สาขา · {selectedPackage.max_devices} Devices · {selectedPackage.max_users} Users
              {selectedPackage.quota_mode !== "standard" ? " · Custom package ไม่เปิดผ่าน Fast Provisioning" : ""}
            </div>
          ) : null}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
            <label style={labelStyle}>รหัสสาขา<input required value={form.branchCode} onChange={(e) => update("branchCode", e.target.value)} style={inputStyle} /></label>
            <label style={labelStyle}>ชื่อสาขา<input required value={form.branchName} onChange={(e) => update("branchName", e.target.value)} style={inputStyle} /></label>
            <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>ที่อยู่สาขา<input value={form.branchAddress} onChange={(e) => update("branchAddress", e.target.value)} style={inputStyle} /></label>
          </div>

          <div style={{ borderTop: "1px solid #e6ebf2", paddingTop: 14 }}>
            <strong style={{ fontSize: 13 }}>Owner คนแรก</strong>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, marginTop: 10 }}>
              <label style={labelStyle}>ชื่อ Owner<input required value={form.ownerName} onChange={(e) => update("ownerName", e.target.value)} style={inputStyle} /></label>
              <label style={labelStyle}>อีเมล Owner<input required type="email" value={form.ownerEmail} onChange={(e) => update("ownerEmail", e.target.value)} style={inputStyle} /></label>
              <label style={labelStyle}>โทรศัพท์<input value={form.ownerPhone} onChange={(e) => update("ownerPhone", e.target.value)} style={inputStyle} /></label>
              <label style={labelStyle}>รหัสพนักงาน Owner<input required inputMode="numeric" pattern="[0-9]{1,32}" value={form.employeeCode} onChange={(e) => update("employeeCode", e.target.value.replace(/\D/g, "").slice(0, 32))} style={inputStyle} /></label>
              <label style={labelStyle}>PIN เริ่มต้น 4–8 หลัก<input required type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{4,8}" value={form.pin} onChange={(e) => update("pin", e.target.value.replace(/\D/g, "").slice(0, 8))} style={inputStyle} /></label>
            </div>
            <p style={{ margin: "8px 0 0", fontSize: 11, color: "#7a8798" }}>PIN ถูก hash ด้วย bcrypt ฝั่ง server และไม่ถูกบันทึกลง provisioning log</p>
          </div>

          {error ? (
            <div style={{ border: "1px solid #f1c3c3", background: "#fff5f5", borderRadius: 9, padding: 10, color: "#a12d2d", fontSize: 12 }}>
              <strong>{error.code}</strong>: {error.message}<br />
              <small>ถ้าเป็น network/Owner step ให้กดซ้ำโดยใช้ Request ID เดิม ระบบจะไม่สร้าง Tenant ซ้ำ</small>
            </div>
          ) : null}

          <button disabled={submitting || packageBlocked} type="submit" style={{ justifySelf: "start", border: 0, borderRadius: 9, padding: "10px 16px", background: submitting || packageBlocked ? "#a9b5c5" : "#246af0", color: "white", fontWeight: 900, cursor: submitting || packageBlocked ? "not-allowed" : "pointer" }}>
            {submitting ? "กำลังเปิดร้าน…" : "สร้างร้าน + สาขา + Owner"}
          </button>
        </form>
      )}
    </section>
  );
}
