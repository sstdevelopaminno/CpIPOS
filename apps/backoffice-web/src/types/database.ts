export type Tables = {
  tenants: {
    Row: {
      id: string;
      code: string;
      name: string;
      package_id: string | null;
      is_active: boolean;
      created_at: string;
    };
  };
  branches: {
    Row: {
      id: string;
      tenant_id: string;
      code: string;
      name: string;
      is_active: boolean;
      created_at: string;
    };
  };
  orders: {
    Row: {
      id: string;
      tenant_id: string;
      branch_id: string;
      order_no: string;
      order_type: "dine_in" | "takeaway" | "delivery_manual";
      channel: string;
      status: "draft" | "queued" | "preparing" | "completed" | "cancelled";
      total_amount: number;
      created_at: string;
    };
  };
  printer_profiles: {
    Row: {
      id: string;
      tenant_id: string;
      branch_id: string;
      printer_name: string;
      printer_role: "receipt" | "kitchen" | "report";
      connection_type: "NETWORK_ESC_POS" | "STAR_WEBPRNT" | "LOCAL_BRIDGE" | "BLUETOOTH_BRIDGE";
      ip_address: string | null;
      port: number | null;
      paper_width_mm: 58 | 80;
      enabled: boolean;
      metadata: Record<string, unknown>;
      created_at: string;
      updated_at: string;
    };
  };
  print_jobs: {
    Row: {
      id: string;
      tenant_id: string;
      branch_id: string;
      order_id: string | null;
      printer_id: string | null;
      printer_role: "receipt" | "kitchen" | "report";
      connection_type: "NETWORK_ESC_POS" | "STAR_WEBPRNT" | "LOCAL_BRIDGE" | "BLUETOOTH_BRIDGE";
      status: "pending" | "printing" | "printed" | "failed" | "retrying";
      payload_text: string;
      payload_json: Record<string, unknown>;
      retry_count: number;
      max_retry_count: number;
      last_error: string | null;
      claimed_by_agent_id: string | null;
      claimed_at: string | null;
      claim_expires_at: string | null;
      agent_attempt_id: string | null;
      agent_error_code: string | null;
      printed_at: string | null;
      failed_at: string | null;
      created_at: string;
      updated_at: string;
      metadata: Record<string, unknown>;
    };
  };
  print_agents: {
    Row: {
      id: string;
      tenant_id: string;
      branch_id: string;
      device_id: string | null;
      device_code: string;
      agent_name: string;
      api_key_hash: string;
      status: "active" | "blocked" | "inactive";
      last_seen_at: string | null;
      last_claim_at: string | null;
      app_version: string | null;
      metadata: Record<string, unknown>;
      created_by: string | null;
      created_at: string;
      updated_at: string;
    };
  };
  cash_drawer_events: {
    Row: {
      id: string;
      tenant_id: string;
      branch_id: string;
      pos_device_id: string | null;
      printer_profile_id: string | null;
      print_job_id: string | null;
      user_id: string | null;
      session_id: string | null;
      shift_id: string | null;
      order_id: string | null;
      payment_id: string | null;
      trigger_source: "manual" | "cash_payment";
      reason: string | null;
      command_status: "queued" | "sent" | "failed";
      physical_status: "open" | "closed" | "unknown" | "unsupported" | "offline";
      error_code: string | null;
      metadata: Record<string, unknown>;
      created_at: string;
    };
  };
};
