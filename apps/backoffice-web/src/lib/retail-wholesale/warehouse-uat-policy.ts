/** Never activate candidate warehouse commands on Vercel production.
 * Requires explicit UAT tenant and preview deployment configuration.
 * A preview MUST point at a separate synthetic database.
 */
export function rwWarehouseUatAllowed(tenantId: string, env: {
  VERCEL_ENV?: string;
  RW_WAREHOUSE_UAT_ENABLED?: string;
  RW_WAREHOUSE_UAT_TENANT_ID?: string;
}): boolean {
  return env.VERCEL_ENV === "preview" && env.RW_WAREHOUSE_UAT_ENABLED === "true"
    && tenantId.length > 0 && env.RW_WAREHOUSE_UAT_TENANT_ID === tenantId;
}
