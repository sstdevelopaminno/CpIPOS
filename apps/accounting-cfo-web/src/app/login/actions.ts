"use server";

import { createSession, type AccountingRole, verifyAccessKey } from "@/lib/auth";
import { redirect } from "next/navigation";

export type LoginState = {
  error?: string;
};

export async function loginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const role = String(formData.get("role") ?? "") as AccountingRole;
  const accessKey = String(formData.get("accessKey") ?? "");

  if (role !== "cfo" && role !== "marketing") {
    return { error: "กรุณาเลือกสิทธิ์ผู้ใช้งาน" };
  }
  if (!verifyAccessKey(role, accessKey)) {
    return { error: "รหัสเข้าใช้งานไม่ถูกต้อง" };
  }

  await createSession(role);
  redirect("/");
}
