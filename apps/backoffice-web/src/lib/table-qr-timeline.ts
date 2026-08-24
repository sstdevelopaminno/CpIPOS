import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type TableQrTimelineScope = {
  tenant_id: string;
  branch_id: string;
  table_id: string;
  table_session_id: string;
  id?: string | null;
};

type TimelineSeverity = "green" | "yellow" | "red";

type DeviceSnapshot = {
  brand: string | null;
  model: string | null;
  deviceClass: "mobile" | "tablet" | "desktop" | "unknown";
  osName: string | null;
  osVersion: string | null;
  browserName: string | null;
  browserVersion: string | null;
  userAgent: string | null;
};

function firstMatch(value: string, expression: RegExp) {
  const match = value.match(expression);
  return match?.[1]?.trim() || null;
}

function cleanVersion(value: string | null) {
  return value?.replace(/_/g, ".").trim() || null;
}

function parseDeviceSnapshot(request: Request): DeviceSnapshot {
  const ua = String(request.headers.get("user-agent") ?? "").trim();
  const clientPlatform = String(request.headers.get("sec-ch-ua-platform") ?? "").replaceAll('"', "").trim();
  const mobileHint = String(request.headers.get("sec-ch-ua-mobile") ?? "").trim();

  let browserName: string | null = null;
  let browserVersion: string | null = null;
  if (/Edg\//i.test(ua)) {
    browserName = "Edge";
    browserVersion = firstMatch(ua, /Edg\/([\d.]+)/i);
  } else if (/OPR\//i.test(ua)) {
    browserName = "Opera";
    browserVersion = firstMatch(ua, /OPR\/([\d.]+)/i);
  } else if (/CriOS\//i.test(ua)) {
    browserName = "Chrome";
    browserVersion = firstMatch(ua, /CriOS\/([\d.]+)/i);
  } else if (/Chrome\//i.test(ua)) {
    browserName = "Chrome";
    browserVersion = firstMatch(ua, /Chrome\/([\d.]+)/i);
  } else if (/FxiOS\//i.test(ua)) {
    browserName = "Firefox";
    browserVersion = firstMatch(ua, /FxiOS\/([\d.]+)/i);
  } else if (/Firefox\//i.test(ua)) {
    browserName = "Firefox";
    browserVersion = firstMatch(ua, /Firefox\/([\d.]+)/i);
  } else if (/Safari\//i.test(ua) && /Version\//i.test(ua)) {
    browserName = "Safari";
    browserVersion = firstMatch(ua, /Version\/([\d.]+)/i);
  }

  let osName: string | null = clientPlatform || null;
  let osVersion: string | null = null;
  if (/Android/i.test(ua)) {
    osName = "Android";
    osVersion = cleanVersion(firstMatch(ua, /Android\s+([\d._]+)/i));
  } else if (/iPhone|iPad|iPod/i.test(ua)) {
    osName = "iOS";
    osVersion = cleanVersion(firstMatch(ua, /OS\s+([\d_]+)/i));
  } else if (/Windows NT/i.test(ua)) {
    osName = "Windows";
    osVersion = firstMatch(ua, /Windows NT\s+([\d.]+)/i);
  } else if (/Mac OS X/i.test(ua)) {
    osName = "macOS";
    osVersion = cleanVersion(firstMatch(ua, /Mac OS X\s+([\d_]+)/i));
  } else if (/Linux/i.test(ua) && !osName) {
    osName = "Linux";
  }

  let model: string | null = null;
  if (/iPhone/i.test(ua)) model = "iPhone";
  else if (/iPad/i.test(ua)) model = "iPad";
  else if (/Android/i.test(ua)) {
    model = firstMatch(ua, /Android[^;)]*;\s*([^;()]+?)\s+Build\//i)
      ?? firstMatch(ua, /Android[^;)]*;\s*([^;()]+?)\)/i);
    if (model && /^(wv|mobile|tablet)$/i.test(model)) model = null;
  }

  let brand: string | null = null;
  const brandSource = `${model ?? ""} ${ua}`;
  if (/iPhone|iPad|Macintosh/i.test(ua)) brand = "Apple";
  else if (/\bSM-[A-Z0-9-]+|Samsung/i.test(brandSource)) brand = "Samsung";
  else if (/Pixel/i.test(brandSource)) brand = "Google";
  else if (/Redmi|POCO|Xiaomi|\bMI\s/i.test(brandSource)) brand = "Xiaomi";
  else if (/OPPO/i.test(brandSource)) brand = "OPPO";
  else if (/vivo/i.test(brandSource)) brand = "vivo";
  else if (/realme/i.test(brandSource)) brand = "realme";
  else if (/HUAWEI/i.test(brandSource)) brand = "Huawei";
  else if (/HONOR/i.test(brandSource)) brand = "HONOR";
  else if (/OnePlus/i.test(brandSource)) brand = "OnePlus";
  else if (/Motorola|moto\s/i.test(brandSource)) brand = "Motorola";

  const isTablet = /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua));
  const isMobile = /iPhone|iPod|Mobile|Android/i.test(ua) || mobileHint === "?1";
  const deviceClass: DeviceSnapshot["deviceClass"] = isTablet ? "tablet" : isMobile ? "mobile" : ua ? "desktop" : "unknown";

  return {
    brand,
    model,
    deviceClass,
    osName,
    osVersion,
    browserName,
    browserVersion,
    userAgent: ua || null
  };
}

function timelineClientId(request: Request) {
  const raw = String(request.headers.get("x-table-order-client-id") ?? "").trim().toLowerCase();
  return /^[a-z0-9_-]{8,120}$/.test(raw) ? raw : "anonymous";
}

function safePayload(value: Record<string, unknown> | null | undefined) {
  if (!value) return {};
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length <= 20_000) return value;
    return { truncated: true, original_bytes: serialized.length };
  } catch {
    return { invalid_payload: true };
  }
}

export async function recordTableQrTimelineEvent(args: {
  request: Request;
  context: TableQrTimelineScope;
  eventType: string;
  severity?: TimelineSeverity;
  requestId?: string | null;
  submissionId?: string | null;
  orderId?: string | null;
  itemCount?: number | null;
  amount?: number | null;
  success?: boolean | null;
  statusCode?: number | null;
  errorCode?: string | null;
  durationMs?: number | null;
  payload?: Record<string, unknown> | null;
}) {
  const device = parseDeviceSnapshot(args.request);
  const supabase = getSupabaseServiceClient();
  try {
    const { error } = await supabase.rpc("record_table_qr_timeline_event", {
      p_tenant_id: args.context.tenant_id,
      p_branch_id: args.context.branch_id,
      p_table_id: args.context.table_id,
      p_table_session_id: args.context.table_session_id,
      p_qr_session_id: args.context.id ?? null,
      p_client_id: timelineClientId(args.request),
      p_event_type: args.eventType,
      p_severity: args.severity ?? "green",
      p_request_id: args.requestId ?? null,
      p_submission_id: args.submissionId ?? null,
      p_order_id: args.orderId ?? null,
      p_item_count: args.itemCount ?? null,
      p_amount: args.amount ?? null,
      p_success: args.success ?? null,
      p_status_code: args.statusCode ?? null,
      p_error_code: args.errorCode ?? null,
      p_duration_ms: args.durationMs ?? null,
      p_device_brand: device.brand,
      p_device_model: device.model,
      p_device_class: device.deviceClass,
      p_os_name: device.osName,
      p_os_version: device.osVersion,
      p_browser_name: device.browserName,
      p_browser_version: device.browserVersion,
      p_user_agent: device.userAgent,
      p_payload: safePayload(args.payload)
    });
    if (error) {
      console.warn("[table-qr-timeline] event write failed", { eventType: args.eventType, message: error.message });
    }
  } catch (error) {
    console.warn("[table-qr-timeline] event write exception", {
      eventType: args.eventType,
      message: error instanceof Error ? error.message : "timeline_write_failed"
    });
  }
}
