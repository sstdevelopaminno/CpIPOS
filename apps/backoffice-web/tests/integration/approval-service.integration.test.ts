import { describe, expect, it, vi } from "vitest";
import type { PinApprovalInput } from "@pos/shared-types";
import { executePinApproval } from "@/lib/services/approval-service";

describe("executePinApproval", () => {
  const auth = {
    userId: "u-staff",
    platformRole: "tenant_user" as const,
    tenantId: "t1",
    branchId: "b1",
    branchRole: "staff" as const
  };

  const input: PinApprovalInput = {
    tenant_id: "t1",
    branch_id: "b1",
    action: "cancel_bill",
    target_table: "orders",
    target_id: "o1",
    manager_pin: "0000"
  };

  it("rejects when pin is invalid and logs failed audit", async () => {
    const appendAuditLog = vi.fn(async () => undefined);

    const result = await executePinApproval({
      auth,
      input,
      validatePin: async () => ({ approved: false }),
      appendAuditLog
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("pin_rejected");
    }
    expect(appendAuditLog).toHaveBeenCalledTimes(1);
    expect(appendAuditLog.mock.calls[0]?.[0]?.action).toBe("pin_approval_failed");
  });

  it("allows a product-specific manager PIN approval action", async () => {
    const appendAuditLog = vi.fn(async () => undefined);
    const scopedProduct = {
      ...input, action: "product_deactivate" as const,
      target_table: "products", target_id: "product-1"
    };
    const result = await executePinApproval({
      auth,
      input: scopedProduct,
      validatePin: async () => ({ approved: true, approverUserId: "u-manager", approverRole: "manager" }),
      appendAuditLog
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.action).toBe("product_deactivate");
      expect(result.data.approver_role).toBe("manager");
    }
    expect(appendAuditLog).toHaveBeenCalledTimes(1);
    expect(appendAuditLog.mock.calls[0]?.[0]?.targetTable).toBe("products");
  });

  it("approves when manager pin matches", async () => {
    const appendAuditLog = vi.fn(async () => undefined);

    const result = await executePinApproval({
      auth,
      input,
      validatePin: async () => ({ approved: true, approverUserId: "u-manager", approverRole: "manager" }),
      appendAuditLog
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.approved).toBe(true);
      expect(result.data.approver_role).toBe("manager");
    }
    expect(appendAuditLog).toHaveBeenCalledTimes(1);
    expect(appendAuditLog.mock.calls[0]?.[0]?.action).toBe("pin_approval_granted");
  });
});

