import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), "src", p), "utf8");
const route = read("app/api/pos/alerts/menu/route.ts");
const service = read("lib/services/pos-menu-operational-alert-service.ts");
const menu = read("components/pos-preview/pos-staff-menu.tsx");
const cashier = read("components/pos/pos-sales-module.tsx");
const kitchen = read("components/kitchen/kitchen-kds.tsx");

describe("POS sales and kitchen navigation badges", () => {
  it("checks POS session, tenant, branch, and permission before reading operational work", () => {
    expect(route).toContain("await requirePosSession()");
    expect(route).toContain('requirePermission(scope, "sales:view")');
    expect(route).toContain('includeSales: role !== "kitchen"');
    expect(route).toContain('response.headers.set("Cache-Control", "private, no-store")');
    for (const table of ["shifts", "table_bill_sessions", "orders", "table_qr_orders", "kitchen_tickets"]) {
      expect(service).toContain(`from("${table}")`);
    }
    expect(service).toContain('.eq("tenant_id", tenantId)');
    expect(service).toContain('.eq("branch_id", branchId)');
  });

  it("only counts active work rather than historical closed shifts and served tickets", () => {
    expect(service).toContain('.in("status", ["open", "suspended"])');
    expect(service).toContain('.is("closed_at", null)');
    expect(service).toContain('.eq("status", "queued")');
    expect(service).toContain('"pending_pos_review"');
  });

  it("acknowledges only a QR service request for an active table, without altering a food order", () => {
    expect(route).toContain('SERVICE_EVENTS = new Set(["call_staff", "request_checkout"])');
    expect(route).toContain('.in("event_type", ["call_staff", "request_checkout"])');
    expect(route).toContain('.is("review_status", null)');
    expect(route).toContain('review_status: "accepted"');
    expect(route).toContain('tableSession.closed_at !== null');
    expect(route).not.toContain('from("orders").update');
  });

  it("renders two independent badges, retaining the existing news and billing counts", () => {
    expect(menu).toContain('item.href === "/preview/pos"');
    expect(menu).toContain('item.href === "/preview/pos/kitchen"');
    expect(menu).toContain("operationAlerts.sales.total");
    expect(menu).toContain("operationAlerts.kitchen.new_dine_in_orders");
    expect(menu).toContain('fetch("/api/pos/alerts/menu", { cache: "no-store" })');
    expect(menu).toContain('30_000');
    expect(menu).toContain("unreadNewsCount");
    expect(menu).toContain("unpaidBillingCount");
  });

  it("updates badges on cashier and kitchen action without forcing page reload or logout", () => {
    expect(cashier).toContain("acknowledgeTableQrServiceEvent");
    expect(cashier).toContain('table.qr_activity?.latest_event_type === "call_staff"');
    expect(cashier).toContain('new Event("cpipos-pos-alerts-refresh")');
    expect(kitchen).toContain('new Event("cpipos-pos-alerts-refresh")');
    expect(menu).toContain('window.addEventListener("cpipos-pos-alerts-refresh"');
    expect(route).not.toContain("logout");
    expect(route).not.toContain("revoke");
  });
});
