"use client";

import { Bell, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export type SalesNotification = {
  id: string;
  title: string;
  message: string;
  tone?: "info" | "success" | "warning";
};

type SalesNotificationBellProps = {
  notifications: SalesNotification[];
};

export function SalesNotificationBell({ notifications }: SalesNotificationBellProps) {
  const [open, setOpen] = useState(false);
  const [readIds, setReadIds] = useState<string[]>([]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("sstipos_mobile_sales_notice_read");
      setReadIds(stored ? (JSON.parse(stored) as string[]) : []);
    } catch {
      setReadIds([]);
    }
  }, []);

  const unreadCount = useMemo(() => notifications.filter((item) => !readIds.includes(item.id)).length, [notifications, readIds]);
  const hasUnread = unreadCount > 0;

  function openNotifications() {
    setOpen(true);
    const nextReadIds = Array.from(new Set([...readIds, ...notifications.map((item) => item.id)]));
    setReadIds(nextReadIds);
    window.localStorage.setItem("sstipos_mobile_sales_notice_read", JSON.stringify(nextReadIds));
  }

  return (
    <>
      <button
        type="button"
        onClick={openNotifications}
        aria-label={hasUnread ? `เปิดรายการแจ้งเตือน ${unreadCount} รายการใหม่` : "เปิดรายการแจ้งเตือน"}
        title="แจ้งเตือน"
        className="relative flex h-12 w-12 items-center justify-center rounded-full border border-[#e4effb] bg-white text-[#17416f] shadow-[0_8px_22px_rgba(15,39,69,0.1)] transition active:scale-95"
      >
        <Bell size={24} strokeWidth={2.25} />
        {hasUnread ? (
          <span
            aria-hidden="true"
            className="absolute right-[9px] top-[9px] h-2.5 w-2.5 rounded-full border-2 border-white bg-[#ef2323] shadow-[0_0_0_2px_rgba(239,35,35,0.12)]"
          />
        ) : null}
      </button>

      {open ? (
        <div role="dialog" aria-modal="true" aria-label="รายการแจ้งเตือน" className="fixed inset-0 z-[220] bg-[rgba(15,39,69,0.34)] px-4 py-[max(20px,env(safe-area-inset-top))]">
          <section className="mx-auto grid max-h-[min(78dvh,520px)] max-w-[390px] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-[22px] border border-[#cfe3fa] bg-white shadow-[0_20px_58px_rgba(15,39,69,0.22)]">
            <header className="flex items-center justify-between gap-3 border-b border-[#e4effb] px-4 py-3">
              <div>
                <h2 className="m-0 text-[18px] font-black text-[#0f2745]">แจ้งเตือน</h2>
                <p className="m-0 mt-1 text-[12px] font-bold text-[#6a7f99]">รายการจากเมนูขายและระบบมือถือ</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="ปิดรายการแจ้งเตือน" className="flex h-10 w-10 items-center justify-center rounded-full border border-[#d9e8f7] bg-white text-[#17416f]">
                <X size={18} />
              </button>
            </header>

            <div className="grid content-start gap-3 overflow-y-auto p-4">
              {notifications.length ? (
                notifications.map((item) => (
                  <article key={item.id} className="rounded-[16px] border border-[#d9e8f7] bg-[#f8fbff] p-3">
                    <div className="flex items-start gap-3">
                      <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${item.tone === "warning" ? "bg-[#ff681f]" : item.tone === "success" ? "bg-[#16a34a]" : "bg-[#1677d9]"}`} />
                      <div className="min-w-0">
                        <h3 className="m-0 text-[14px] font-black text-[#0f2745]">{item.title}</h3>
                        <p className="m-0 mt-1 text-[12px] font-bold leading-snug text-[#587398]">{item.message}</p>
                      </div>
                    </div>
                  </article>
                ))
              ) : (
                <div className="rounded-[16px] border border-[#d9e8f7] bg-[#f8fbff] p-4 text-center text-[13px] font-bold text-[#587398]">ยังไม่มีรายการแจ้งเตือน</div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
