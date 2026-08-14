// Backward-compatible alias. The legacy implementation used to return a fake
// tenant UUID without provisioning production data. Keep the old URL working,
// but route every operation through the real v1 Control Plane workflow.
export { GET, POST } from "@/app/api/it-admin/v1/tenants/route";
