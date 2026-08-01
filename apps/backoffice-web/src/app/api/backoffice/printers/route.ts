import type { PrinterConnectionType } from "@pos/shared-types";
import { getAuthContext } from "@/lib/auth-context";
import { fail, ok } from "@/lib/http";
import { buildPaginationMeta, parsePagination } from "@/lib/query-params";
import { loggedPrintApiFail } from "@/lib/printing/print-api-errors";
import { createPrinterProfile, listPrinterProfiles, updatePrinterProfile } from "@/lib/printing/print-service";

type CreatePrinterPayload = {
  printer_name: string;
  printer_role: "receipt" | "kitchen" | "report";
  connection_type: PrinterConnectionType;
  ip_address?: string | null;
  port?: number | null;
  paper_width_mm: 58 | 80;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
};

type UpdatePrinterPayload = CreatePrinterPayload & {
  printer_id?: string | null;
};

export async function GET(req: Request) {
  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    const { searchParams } = new URL(req.url);
    const { page, pageSize } = parsePagination(searchParams, 10);
    const all = await listPrinterProfiles(auth);

    const from = Math.max(0, (page - 1) * pageSize);
    const to = from + pageSize;
    const items = all.slice(from, to);

    return ok({
      items,
      pagination: buildPaginationMeta(page, pageSize, all.length)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "forbidden_role") {
      return fail("forbidden_role", "Only manager or owner can access printer settings.", 403);
    }
    return loggedPrintApiFail("printer list failed", error, "printer_list_failed", "Printer settings could not be loaded. Please retry.", 400);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    const body = (await req.json()) as CreatePrinterPayload;

    if (!body.printer_name?.trim()) {
      return fail("invalid_printer_name", "printer_name is required.", 422);
    }

    const created = await createPrinterProfile(auth, {
      printer_name: body.printer_name,
      printer_role: body.printer_role,
      connection_type: body.connection_type,
      ip_address: body.ip_address ?? null,
      port: body.port ?? null,
      paper_width_mm: body.paper_width_mm,
      enabled: body.enabled ?? true,
      metadata: body.metadata ?? {}
    });

    return ok(created, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "forbidden_role") {
      return fail("forbidden_role", "Only manager or owner can create printer settings.", 403);
    }
    if (message === "ip_address_required_for_network_esc_pos") {
      return fail("invalid_ip_address", "NETWORK_ESC_POS requires ip_address.", 422);
    }
    if (message === "bluetooth_target_required") {
      return fail("invalid_bluetooth_target", "BLUETOOTH_BRIDGE requires bluetooth_address or bluetooth_name in metadata.", 422);
    }
    if (message === "bluetooth_bridge_url_required") {
      return fail("invalid_bluetooth_bridge_url", "BLUETOOTH_BRIDGE requires metadata.bridge_url or PRINT_BLUETOOTH_BRIDGE_URL.", 422);
    }
    if (message === "local_bridge_url_required") {
      return fail("invalid_local_bridge_url", "LOCAL_BRIDGE requires metadata.bridge_url or PRINT_BRIDGE_URL.", 422);
    }
    if (message === "star_webprnt_url_required") {
      return fail("invalid_webprnt_url", "STAR_WEBPRNT requires metadata.webprnt_url.", 422);
    }
    if (message.includes("duplicate key value violates unique constraint")) {
      return fail("printer_name_conflict", "Printer name already exists in this branch.", 409);
    }
    return loggedPrintApiFail("printer create failed", error, "printer_create_failed", "Printer settings could not be saved. Please retry.", 400);
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    const body = (await req.json()) as UpdatePrinterPayload;
    const printerId = body.printer_id?.trim();

    if (!printerId) return fail("invalid_printer_id", "printer_id is required.", 422);
    if (!body.printer_name?.trim()) return fail("invalid_printer_name", "printer_name is required.", 422);

    const updated = await updatePrinterProfile(auth, printerId, {
      printer_name: body.printer_name,
      printer_role: body.printer_role,
      connection_type: body.connection_type,
      ip_address: body.ip_address ?? null,
      port: body.port ?? null,
      paper_width_mm: body.paper_width_mm,
      enabled: body.enabled ?? true,
      metadata: body.metadata ?? {}
    });

    return ok(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "forbidden_role") return fail("forbidden_role", "Only manager or owner can update printer settings.", 403);
    if (message === "printer_not_found") return fail("printer_not_found", "Printer is not found in this branch.", 404);
    if (message === "ip_address_required_for_network_esc_pos") return fail("invalid_ip_address", "NETWORK_ESC_POS requires ip_address.", 422);
    if (message === "bluetooth_target_required") return fail("invalid_bluetooth_target", "BLUETOOTH_BRIDGE requires bluetooth_address or bluetooth_name in metadata.", 422);
    if (message === "bluetooth_bridge_url_required") return fail("invalid_bluetooth_bridge_url", "BLUETOOTH_BRIDGE requires metadata.bridge_url or PRINT_BLUETOOTH_BRIDGE_URL.", 422);
    if (message === "local_bridge_url_required") return fail("invalid_local_bridge_url", "LOCAL_BRIDGE requires metadata.bridge_url or PRINT_BRIDGE_URL.", 422);
    if (message === "star_webprnt_url_required") return fail("invalid_webprnt_url", "STAR_WEBPRNT requires metadata.webprnt_url.", 422);
    if (message.includes("duplicate key value violates unique constraint")) return fail("printer_name_conflict", "Printer name already exists in this branch.", 409);
    return loggedPrintApiFail("printer update failed", error, "printer_update_failed", "Printer settings could not be updated. Please retry.", 400);
  }
}
