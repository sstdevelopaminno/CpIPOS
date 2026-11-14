"use client";

import { useEffect } from "react";

export default function PosRouteError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[pos-route] unable to load protected POS screen", error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-5 text-slate-900">
      <section role="alert" className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
        <h1 className="text-xl font-bold">ไม่สามารถตรวจสอบสิทธิ์ POS ได้ชั่วคราว</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          ระบบยังไม่ได้ยืนยันว่า Session หมดอายุ จึงไม่ออกจากระบบหรือสลับหน้าเข้าสู่ระบบอัตโนมัติ
          กรุณาตรวจสอบอีกครั้งเมื่อการเชื่อมต่อกลับมาปกติ
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 rounded-xl bg-blue-600 px-5 py-3 font-bold text-white"
        >
          ตรวจสอบอีกครั้ง
        </button>
      </section>
    </main>
  );
}
