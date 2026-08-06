"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getMobileMenuItems } from "@/lib/permissions/mobile-menu";
import type { BranchRole } from "@/types/contracts";

export function BottomNav({ role }: { role: BranchRole }) {
  const pathname = usePathname();
  const items = getMobileMenuItems(role);
  if (items.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-20 px-2"
      style={{
        position: "fixed",
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 20,
        padding: "0 18px max(8px, env(safe-area-inset-bottom))",
      }}
    >
      <nav
        aria-label="เมนูหลัก"
        className="pointer-events-auto relative mx-auto h-[96px] w-full max-w-[390px] overflow-visible"
        style={{
          position: "relative",
          height: 96,
          width: "100%",
          maxWidth: 390,
          margin: "0 auto",
          overflow: "visible",
        }}
      >
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
          preserveAspectRatio="none"
          viewBox="0 0 430 96"
          style={{
            position: "absolute",
            inset: 0,
            height: "100%",
            width: "100%",
            overflow: "visible",
            pointerEvents: "none",
            filter: "drop-shadow(0 -8px 22px rgba(15, 39, 69, 0.11))",
          }}
        >
          <path
            d="M22 10 H142 C172 10 170 66 215 66 C260 66 258 10 288 10 H408 C420 10 430 20 430 32 V74 C430 86 420 96 408 96 H22 C10 96 0 86 0 74 V32 C0 20 10 10 22 10 Z"
            fill="#fff"
            stroke="#cfe4fb"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        <div
          className="relative grid h-full"
          style={{
            position: "relative",
            display: "grid",
            height: "100%",
            gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
          }}
        >
          {items.map(({ href, icon: Icon, label }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            const isProduct = href === "/stock";

            if (isProduct) {
              return (
                <Link
                  key={href}
                  href={href}
                  prefetch
                  aria-label={label}
                  aria-current={active ? "page" : undefined}
                  className="relative z-10 flex min-w-0 touch-manipulation flex-col items-center justify-start text-center no-underline outline-none transition-transform duration-200 active:scale-95"
                  style={{
                    position: "relative",
                    zIndex: 10,
                    display: "flex",
                    minWidth: 0,
                    minHeight: 76,
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "flex-start",
                    gap: 2,
                    paddingTop: 0,
                    color: active ? "#1677d9" : "#214461",
                    textAlign: "center",
                    textDecoration: "none",
                    outline: "none",
                    transition: "transform 180ms ease, color 180ms ease",
                  }}
                >
                  <span
                    className="flex flex-col items-center justify-center rounded-full border bg-white"
                    style={{
                      display: "flex",
                      width: 80,
                      height: 80,
                      marginTop: 10,
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 1,
                      border: active ? "1px solid #b7d8fb" : "1px solid #cfe4fb",
                      borderRadius: 999,
                      background: "#fff",
                      color: active ? "#1677d9" : "#214461",
                      boxShadow: active ? "0 12px 26px rgba(22, 119, 217, 0.23)" : "0 8px 22px rgba(22, 119, 217, 0.15)",
                      transform: active ? "scale(1.03)" : "scale(1)",
                      transition: "transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease",
                    }}
                  >
                    <Icon aria-hidden="true" size={36} strokeWidth={active ? 2.45 : 2.25} />
                    <span
                      style={{
                        color: active ? "#1677d9" : "#214461",
                        fontSize: 10,
                        fontWeight: 900,
                        lineHeight: 1.05,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {label}
                    </span>
                  </span>
                </Link>
              );
            }

            return (
              <Link
                key={href}
                href={href}
                prefetch
                aria-label={label}
                aria-current={active ? "page" : undefined}
                className="relative z-10 flex min-w-0 touch-manipulation flex-col items-center justify-center gap-1 px-1 text-center no-underline outline-none transition active:scale-95"
                style={{
                  position: "relative",
                  zIndex: 10,
                  display: "flex",
                  minWidth: 0,
                  minHeight: 70,
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4,
                  padding: "0 4px",
                  color: active ? "#1677d9" : "#53657c",
                  textAlign: "center",
                  textDecoration: "none",
                  outline: "none",
                  transition: "transform 160ms ease, color 160ms ease",
                }}
              >
                <span
                  className="flex items-center justify-center rounded-[14px]"
                  style={{
                    display: "flex",
                    height: 34,
                    width: 34,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 14,
                    background: active ? "#eef6ff" : "transparent",
                    color: active ? "#1677d9" : "#53657c",
                    transition: "background 160ms ease, color 160ms ease",
                  }}
                >
                  <Icon aria-hidden="true" size={22} strokeWidth={active ? 2.45 : 2.15} />
                </span>
                <span
                  style={{
                    display: "block",
                    maxWidth: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    color: active ? "#1677d9" : "#53657c",
                    fontSize: 10,
                    fontWeight: active ? 900 : 800,
                    lineHeight: 1.15,
                    whiteSpace: "nowrap",
                  }}
                >
                  {label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
