import { NextResponse } from "next/server";
import { getOperator } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase";

type Body = {
  product_profile?: string;
  store_code?: string;
  tenant_code?: string;
  tenant_name?: string;
  branch_code?: string;
  branch_name?: string;
  package_code?: string;
};

type Check = { key: string; label: string; ok: boolean; detail: string };

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  const operator = await getOperator();
  if (!operator) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const storeCode = text(body.store_code).toUpperCase();
  const tenantCode = text(body.tenant_code).toUpperCase();
  const tenantName = text(body.tenant_name);
  const branchCode = text(body.branch_code).toUpperCase();
  const branchName = text(body.branch_name);
  const packageCode = text(body.package_code).toLowerCase();
  const requestedProfile = text(body.product_profile).toUpperCase();
  const derivedProfile = storeCode.startsWith("FG") ? "RESTAURANT_QR" : storeCode.startsWith("FF") ? "BUFFET" : "UNKNOWN";

  const checks: Check[] = [];
  const errors: string[] = [];
  const add = (key: string, label: string, ok: boolean, detail: string) => {
    checks.push({ key, label, ok, detail });
    if (!ok) errors.push(detail);
  };

  add("store_format", "Store code format", /^(FG|FF)\d{4}$/.test(storeCode), "Store code ต้องเป็น FG#### หรือ FF####");
  add("profile_match", "Product profile", derivedProfile !== "UNKNOWN" && derivedProfile === requestedProfile, `Product profile ต้องตรงกับ prefix (${derivedProfile})`);
  add("tenant_code", "Tenant code", /^[A-Z0-9][A-Z0-9-]{2,31}$/.test(tenantCode), "Tenant code ต้องเป็น A-Z, 0-9 หรือ - ความยาว 3-32 ตัว");
  add("managed_code_match", "Managed store identity", tenantCode === storeCode, "ร้าน FG/FF ใหม่ต้องใช้ tenants.code ตรงกับ Store Code");
  add("tenant_name", "Store name", tenantName.length >= 2 && tenantName.length <= 120, "ชื่อร้านต้องมี 2-120 ตัวอักษร");
  add("branch_code", "Branch code", branchCode.length >= 3 && branchCode.length <= 48 && /^[A-Z0-9-]+$/.test(branchCode), "Branch code ต้องเป็น A-Z, 0-9 หรือ -");
  add("branch_name", "Branch name", branchName.length >= 2 && branchName.length <= 120, "ชื่อสาขาต้องมี 2-120 ตัวอักษร");
  add("package_required", "Package", packageCode.length > 0, "ต้องเลือก Package");

  if (errors.length > 0) {
    return NextResponse.json({
      ready: false,
      mode: "DRY_RUN",
      checks,
      errors,
      normalized: { store_code: storeCode, tenant_code: tenantCode, tenant_name: tenantName, branch_code: branchCode, branch_name: branchName, package_code: packageCode, product_profile: derivedProfile },
      writes_performed: 0
    });
  }

  const supabase = getServiceClient();
  const [storeResult, branchResult, packageResult] = await Promise.all([
    // tenants.code is the managed store-code source of truth (FG0003/FG0004). tenant_access_codes is a separate numeric access credential.
    supabase.from("tenants").select("id,code,name,is_active").eq("code", storeCode).limit(1),
    supabase.from("branches").select("id,tenant_id,code,name,is_active").eq("code", branchCode).limit(1),
    supabase.from("subscription_packages").select("id,code,name,status,is_active,max_branches,max_devices").eq("code", packageCode).limit(1)
  ]);

  const queryErrors = [storeResult.error, branchResult.error, packageResult.error].filter(Boolean);
  if (queryErrors.length > 0) {
    return NextResponse.json({ error: "preflight_query_failed", detail: queryErrors.map((e) => e?.message) }, { status: 500 });
  }

  const storeFree = (storeResult.data ?? []).length === 0;
  const branchFree = (branchResult.data ?? []).length === 0;
  const selectedPackage = (packageResult.data ?? [])[0] ?? null;
  const packageActive = Boolean(selectedPackage?.is_active && selectedPackage?.status === "active");

  add("store_collision", "Store / tenant code available", storeFree, storeFree ? `${storeCode} พร้อมใช้งาน` : `${storeCode} ถูกใช้งานแล้ว`);
  add("branch_collision", "Branch code available", branchFree, branchFree ? `${branchCode} พร้อมใช้งาน` : `${branchCode} ถูกใช้งานแล้ว`);
  add("package_active", "Package active", packageActive, packageActive ? `${selectedPackage.name} พร้อมใช้งาน` : `Package ${packageCode} ไม่พร้อมใช้งาน`);

  return NextResponse.json({
    ready: checks.every((check) => check.ok),
    mode: "DRY_RUN",
    operator_role: operator.role,
    checks,
    errors: checks.filter((check) => !check.ok).map((check) => check.detail),
    normalized: {
      store_code: storeCode,
      tenant_code: storeCode,
      tenant_name: tenantName,
      branch_code: branchCode,
      branch_name: branchName,
      package_code: packageCode,
      product_profile: derivedProfile,
      customer_access_code: "GENERATE_SEPARATELY",
      deployment_mode: "CENTRAL",
      update_ring: "PILOT",
      initial_status: "PROVISIONING",
      tenant_is_active: false,
      branch_is_active: false
    },
    package: selectedPackage ? { id: selectedPackage.id, code: selectedPackage.code, name: selectedPackage.name, max_branches: selectedPackage.max_branches, max_devices: selectedPackage.max_devices } : null,
    writes_performed: 0
  });
}
