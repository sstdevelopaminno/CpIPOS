import { NextResponse } from "next/server";
import {
  BUFFET_PRODUCT_PROFILE,
  BUFFET_RESERVED_FIRST_STORE_CODE,
  BUFFET_STORE_CODE_PREFIX
} from "@/lib/buffet-profile";

export const dynamic = "force-dynamic";

function normalize(value: string | undefined): string {
  return String(value ?? "").trim().toUpperCase();
}

export async function GET() {
  const configuredProfile = normalize(process.env.CPIPOS_PRODUCT_PROFILE);
  const isBuffetDeployment = configuredProfile === BUFFET_PRODUCT_PROFILE;

  return NextResponse.json(
    {
      product_profile: configuredProfile || "UNSET",
      deployment_lane: isBuffetDeployment ? "BUFFET_WEB" : "CORE_WEB",
      store_code_prefix: isBuffetDeployment ? BUFFET_STORE_CODE_PREFIX : null,
      reserved_store_code: isBuffetDeployment ? BUFFET_RESERVED_FIRST_STORE_CODE : null,
      ready_for_store_provisioning: false
    },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
