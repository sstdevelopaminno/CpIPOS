import { cookies } from "next/headers";

export type AppLanguage = "th" | "en" | "lo";

export function normalizeLanguage(value?: string | null): AppLanguage {
  return value === "en" || value === "lo" ? value : "th";
}

export async function getServerLanguage(): Promise<AppLanguage> {
  const cookieStore = await cookies();
  return normalizeLanguage(cookieStore.get("sstipos_lang")?.value ?? null);
}
