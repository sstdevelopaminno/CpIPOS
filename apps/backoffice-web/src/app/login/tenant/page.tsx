import { TenantPosLaunch } from "@/components/auth/tenant-pos-launch";

export default async function TenantPosLaunchPage({
  searchParams
}: {
  searchParams: Promise<{ store?: string | string[] }>;
}) {
  const query = await searchParams;
  const storeCode = Array.isArray(query.store) ? query.store[0] ?? "" : query.store ?? "";
  return <TenantPosLaunch storeCode={storeCode} />;
}
