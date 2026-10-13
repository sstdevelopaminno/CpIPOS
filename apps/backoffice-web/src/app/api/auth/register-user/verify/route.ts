import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { getRequestMeta, writeAuditLog } from "@/lib/server/audit-log";
import { buildRateLimitKey, enforceRateLimit, getClientIpAddress, readRateLimitSetting } from "@/lib/server/rate-limit";
import { deriveEmployeeCode, type BranchRole } from "@/lib/server/pre-entry-auth";

type RequestBody = {
  store_code?: string;
  full_name?: string;
  username?: string;
};

type RawUserRow = {
  user_id: string;
  role: BranchRole;
  users_profiles:
    | { id: string; email: string | null; full_name: string; is_active: boolean }
    | Array<{ id: string; email: string | null; full_name: string; is_active: boolean }>;
};

type ActiveUser = {
  id: string;
  email: string | null;
  fullName: string;
  role: BranchRole;
};

function normalizeStoreCode(value: string) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 32);
}

function normalizeName(value: string) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

function normalizeLookup(value: string) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeUsername(value: string) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .slice(0, 120);
}

function usernameMatches(input: string, user: ActiveUser) {
  const normalizedInput = normalizeUsername(input);
  if (!normalizedInput) return false;

  const email = String(user.email ?? "").trim().toLowerCase();
  const emailLocalPart = email.includes("@") ? email.split("@")[0] : "";
  const employeeCode = deriveEmployeeCode(user.id).toLowerCase();
  const compactFullName = normalizeLookup(user.fullName).replace(/\s+/g, "");

  const candidates = new Set<string>([employeeCode, email, emailLocalPart, compactFullName]);
  return candidates.has(normalizedInput);
}

function roleNameAliases(role: BranchRole) {
  if (role === "owner") return ["เจ้าของร้าน", "owner"];
  if (role === "manager") return ["ผู้จัดการร้าน", "manager"];
  return ["พนักงาน", "staff"];
}

function fullNameMatches(input: string, user: ActiveUser) {
  const normalizedInput = normalizeLookup(input);
  if (!normalizedInput) return false;

  const profileFullName = normalizeLookup(user.fullName);
  if (profileFullName === normalizedInput) return true;

  const email = String(user.email ?? "").trim().toLowerCase();
  const emailLocalPart = normalizeLookup(email.includes("@") ? email.split("@")[0] : "");
  if (emailLocalPart && emailLocalPart === normalizedInput) return true;

  const aliases = roleNameAliases(user.role).map((alias) => normalizeLookup(alias));
  return aliases.includes(normalizedInput);
}

function dedupeUsers(rows: ActiveUser[]) {
  const byUserId = new Map<string, ActiveUser>();
  for (const row of rows) {
    if (!byUserId.has(row.id)) {
      byUserId.set(row.id, row);
    }
  }
  return Array.from(byUserId.values());
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as RequestBody | null;
  const storeCode = normalizeStoreCode(String(body?.store_code ?? ""));
  const fullName = normalizeName(String(body?.full_name ?? ""));
  const username = String(body?.username ?? "").trim();
  const clientIp = getClientIpAddress(request);
  const { ipAddress, userAgent } = getRequestMeta(request);

  if (!storeCode) {
    return NextResponse.json({ data: null, error: { code: "store_code_required", message: "กรุณากรอกรหัสร้านค้า" } }, { status: 400 });
  }
  if (!fullName) {
    return NextResponse.json({ data: null, error: { code: "full_name_required", message: "กรุณากรอกชื่อ" } }, { status: 400 });
  }
  if (!username) {
    return NextResponse.json({ data: null, error: { code: "username_required", message: "กรุณากรอกชื่อผู้ใช้งาน" } }, { status: 400 });
  }

  const rateResult = await enforceRateLimit({
    namespace: "register_user_verify",
    key: buildRateLimitKey({ namespace: "login:register-user", parts: [clientIp, storeCode, username] }),
    max: readRateLimitSetting("POS_REGISTER_VERIFY_RATE_LIMIT_MAX", 20, { min: 5, max: 200 }),
    windowMs: readRateLimitSetting("POS_PUBLIC_RATE_LIMIT_WINDOW_SECONDS", 60, { min: 10, max: 3600 }) * 1000,
    failClosedOnBackendError: true
  });
  if (!rateResult.ok) {
    const response = NextResponse.json(
      { data: null, error: { code: "rate_limited", message: "มีการลองหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่" } },
      { status: 429 }
    );
    response.headers.set("Retry-After", String(rateResult.retryAfterSeconds));
    return response;
  }

  try {
    const supabase = getSupabaseServiceClient();
    const { data: tenant } = await supabase
      .from("tenants")
      .select("id,code,name,is_active")
      .eq("code", storeCode)
      .maybeSingle<{ id: string; code: string; name: string; is_active: boolean }>();

    if (!tenant || tenant.is_active === false) {
      return NextResponse.json({ data: null, error: { code: "store_not_found", message: "ไม่พบรหัสร้านค้านี้ หรือร้านยังไม่เปิดใช้งาน" } }, { status: 404 });
    }

    const { data: rows, error: rowsError } = await supabase
      .from("user_branch_roles")
      .select("user_id,role,users_profiles!inner(id,email,full_name,is_active)")
      .eq("tenant_id", tenant.id);

    if (rowsError) {
      throw new Error(rowsError.message);
    }

    const activeUsersRaw = ((rows ?? []) as RawUserRow[])
      .map((row) => {
        const profile = Array.isArray(row.users_profiles) ? row.users_profiles[0] : row.users_profiles;
        if (!profile || profile.is_active === false) return null;
        return {
          id: profile.id,
          email: profile.email,
          fullName: profile.full_name,
          role: row.role
        } satisfies ActiveUser;
      })
      .filter((row): row is ActiveUser => Boolean(row));

    const activeUsers = dedupeUsers(activeUsersRaw);

    const usernameMatchedUsers = activeUsers.filter((user) => usernameMatches(username, user));
    if (usernameMatchedUsers.length === 0) {
      return NextResponse.json({ data: null, error: { code: "user_not_found", message: "ไม่พบชื่อผู้ใช้งานในร้านนี้" } }, { status: 404 });
    }
    if (usernameMatchedUsers.length > 1) {
      return NextResponse.json(
        { data: null, error: { code: "user_ambiguous", message: "พบข้อมูลซ้ำ กรุณาติดต่อผู้ดูแลร้านเพื่อตรวจสอบสิทธิ์" } },
        { status: 409 }
      );
    }

    const user = usernameMatchedUsers[0];
    const nameMatched = fullNameMatches(fullName, user);

    await writeAuditLog({
      tenantId: tenant.id,
      actorUserId: user.id,
      actorRole: user.role,
      targetUserId: user.id,
      action: "register_user_verify_success",
      targetType: "users_profiles",
      targetId: user.id,
      ipAddress,
      userAgent,
      metadata: {
        store_code: tenant.code,
        full_name_match: nameMatched
      }
    });

    return NextResponse.json({
      data: {
        status: "verified",
        tenant: {
          id: tenant.id,
          code: tenant.code,
          name: tenant.name
        },
        user: {
          id: user.id,
          full_name: user.fullName,
          employee_code: deriveEmployeeCode(user.id)
        },
        verification: {
          full_name_match: nameMatched
        }
      },
      error: null
    });
  } catch (error) {
    console.error("[auth/register-user/verify] unexpected error", {
      storeCode,
      error: error instanceof Error ? error.message : "Unknown error"
    });
    return NextResponse.json(
      { data: null, error: { code: "register_verify_failed", message: "ไม่สามารถตรวจสอบข้อมูลลงทะเบียนได้ในขณะนี้" } },
      { status: 500 }
    );
  }
}
