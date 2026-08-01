import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { AuthTimeoutError, withAuthTimeout } from "@/lib/server/auth-timeout";
import { clearPreEntryFlowState, createFlowState, readPreEntryFlowState, writePreEntryFlowState } from "@/lib/server/pre-entry-state";
import { resolveSessionCookieConfig } from "@/lib/server/pos-session";
import { requirePosSession } from "@/lib/pos-session-guard";
import { resolveStoreLoginMode, shouldSkipBranchSelection } from "@/lib/server/store-login-mode";

type BranchSummary = {
  id: string;
  code: string | null;
  name: string | null;
  is_active: boolean;
};

type FlowState = NonNullable<ReturnType<typeof readPreEntryFlowState>>;

function isAutoSkipEnabled() {
  const raw = String(process.env.POS_AUTO_SKIP_SINGLE_BRANCH ?? "true").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function clearPosSessionCookies(response: NextResponse) {
  const config = resolveSessionCookieConfig();
  response.cookies.set({
    name: config.name,
    value: "",
    httpOnly: true,
    secure: config.secure,
    sameSite: "lax",
    path: "/",
    domain: config.domain,
    maxAge: 0
  });
  response.cookies.set({
    name: config.sessionIdName,
    value: "",
    httpOnly: true,
    secure: config.secure,
    sameSite: "lax",
    path: "/",
    domain: config.domain,
    maxAge: 0
  });
}

async function revokeCurrentPosSessionBestEffort() {
  try {
    const scope = await requirePosSession();
    await withAuthTimeout(
      getSupabaseServiceClient()
        .from("pos_sessions")
        .update({ status: "revoked", revoked_at: new Date().toISOString() })
        .eq("id", scope.session.id)
        .eq("status", "active"),
      "session_context_revoke_timeout",
      3000
    );
  } catch (error) {
    if (error instanceof AuthTimeoutError) {
      console.warn("[auth/session/context] revoke timed out", {
        code: error.code,
        timeoutMs: error.timeoutMs
      });
    }
  }
}

async function recoverSingleBranchFlow(flow: FlowState): Promise<FlowState> {
  if (flow.branchId || flow.stage !== "store_verified") return flow;

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("branches")
    .select("id,code,name,is_active")
    .eq("tenant_id", flow.tenantId)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) return flow;

  const branches = ((data ?? []) as BranchSummary[]).filter((branch) => branch.is_active);
  const mode = await resolveStoreLoginMode(flow.tenantId);
  if (!shouldSkipBranchSelection(mode, branches.length, isAutoSkipEnabled())) return flow;

  const branch = branches[0];
  return createFlowState({
    ...flow,
    stage: "branch_selected",
    branchId: branch.id,
    branchCode: branch.code,
    branchName: branch.name
  });
}

export async function GET() {
  const cookieStore = await cookies();
  const rawFlow = readPreEntryFlowState(cookieStore);
  if (!rawFlow) {
    return NextResponse.json({
      data: {
        stage: "none",
        tenant: null,
        branch: null,
        employee: null,
        permissions: []
      },
      error: null
    });
  }

  const flow = await withAuthTimeout(recoverSingleBranchFlow(rawFlow), "session_context_branch_recovery_timeout");
  const response = NextResponse.json({
    data: {
      stage: flow.stage,
      tenant: {
        id: flow.tenantId,
        code: flow.storeCode,
        name: flow.tenantName
      },
      branch: flow.branchId
        ? {
            id: flow.branchId,
            code: flow.branchCode ?? null,
            name: flow.branchName ?? null
          }
        : null,
      employee: flow.userId
        ? {
            id: flow.userId,
            name: flow.employeeName ?? null,
            code: flow.employeeCode ?? null,
            role: flow.userRole ?? null,
            method: flow.employeeAuthMethod ?? null
          }
        : null,
      permissions: flow.permissions ?? []
    },
    error: null
  });

  if (flow !== rawFlow) writePreEntryFlowState(response, flow);
  return response;
}

export async function DELETE() {
  await revokeCurrentPosSessionBestEffort();

  const response = NextResponse.json({
    data: {
      cleared: true
    },
    error: null
  });
  clearPosSessionCookies(response);
  clearPreEntryFlowState(response);
  return response;
}