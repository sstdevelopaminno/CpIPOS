export type PosSubscriptionContractSnapshot = {
  status: string | null;
  started_at: string | null;
  ended_at: string | null;
  metadata: unknown;
};

export type PosTenantLifecycleSnapshot = {
  lifecycle_status: string | null;
  access_locked: boolean | null;
  lock_reason: string | null;
  metadata: unknown;
};

export type PosSubscriptionAccessState = {
  blocked: boolean;
  status: "active" | "trial" | "suspended" | "cancelled" | "expired" | "unknown";
  title: string | null;
  message: string | null;
  updated_at: string | null;
};

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function cleanText(value: unknown, max = 600): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeStatus(value: unknown): PosSubscriptionAccessState["status"] {
  const status = cleanText(value, 30).toLowerCase();
  if (status === "active" || status === "trial" || status === "suspended" || status === "cancelled" || status === "expired") {
    return status;
  }
  return "unknown";
}

function expiredAt(endedAt: string | null | undefined, nowMs: number) {
  if (!endedAt) return false;
  const endMs = new Date(endedAt).getTime();
  return Number.isFinite(endMs) && endMs <= nowMs;
}

function defaultNotice(status: PosSubscriptionAccessState["status"]) {
  if (status === "suspended") {
    return {
      title: "ระบบถูกระงับชั่วคราว",
      message: "การใช้งาน POS ของร้านนี้ถูกระงับชั่วคราว กรุณาติดต่อผู้ดูแลระบบ"
    };
  }
  if (status === "cancelled") {
    return {
      title: "แพ็กเกจสิ้นสุดการใช้งาน",
      message: "แพ็กเกจของร้านนี้ถูกยกเลิก กรุณาติดต่อผู้ดูแลระบบ"
    };
  }
  if (status === "expired") {
    return {
      title: "แพ็กเกจหมดอายุ",
      message: "แพ็กเกจของร้านนี้หมดอายุแล้ว กรุณาติดต่อผู้ดูแลระบบเพื่อต่ออายุการใช้งาน"
    };
  }
  return { title: null, message: null };
}

export function resolvePosSubscriptionAccess(
  contract: PosSubscriptionContractSnapshot | null,
  lifecycle: PosTenantLifecycleSnapshot | null,
  nowMs = Date.now()
): PosSubscriptionAccessState {
  const contractMeta = asRecord(contract?.metadata);
  const lifecycleMeta = asRecord(lifecycle?.metadata);
  const lifecycleNotice = asRecord(lifecycleMeta.pos_notice);

  let status = normalizeStatus(contract?.status);
  if ((status === "active" || status === "trial") && expiredAt(contract?.ended_at, nowMs)) {
    status = "expired";
  }

  const lifecycleStatus = normalizeStatus(lifecycle?.lifecycle_status);
  const lifecycleLocked = lifecycle?.access_locked === true;

  if (lifecycleLocked) {
    if (lifecycleStatus === "suspended" || lifecycleStatus === "cancelled" || lifecycleStatus === "expired") {
      status = lifecycleStatus;
    } else if (cleanText(lifecycle?.lock_reason, 100).includes("cancel")) {
      status = "cancelled";
    } else if (cleanText(lifecycle?.lock_reason, 100).includes("suspend")) {
      status = "suspended";
    } else if (status === "active" || status === "trial" || status === "unknown") {
      status = "suspended";
    }
  }

  const blocked = lifecycleLocked || status === "suspended" || status === "cancelled" || status === "expired";
  if (!blocked) {
    return {
      blocked: false,
      status,
      title: null,
      message: null,
      updated_at: null
    };
  }

  const defaults = defaultNotice(status);
  const title =
    cleanText(lifecycleNotice.title, 120) ||
    cleanText(contractMeta.customer_title, 120) ||
    defaults.title ||
    "ไม่สามารถใช้งาน POS ได้";
  const message =
    cleanText(lifecycleNotice.message, 600) ||
    cleanText(contractMeta.customer_message, 600) ||
    defaults.message ||
    "กรุณาติดต่อผู้ดูแลระบบ";
  const updatedAt =
    cleanText(lifecycleNotice.updated_at, 80) ||
    cleanText(contractMeta.suspended_at, 80) ||
    cleanText(contractMeta.cancelled_at, 80) ||
    contract?.ended_at ||
    null;

  return {
    blocked: true,
    status,
    title,
    message,
    updated_at: updatedAt
  };
}
