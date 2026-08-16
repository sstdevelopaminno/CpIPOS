import Link from "next/link";
import type { AccountingRole } from "@/lib/auth";

export function AppNav({ role }: { role: AccountingRole }) {
  const items =
    role === "cfo"
      ? [
          ["/", "ภาพรวม", "⌂"],
          ["/transactions?type=income", "รายการ", "฿"],
          ["/documents", "เอกสาร", "▤"],
          ["/bank", "ธนาคาร", "▣"],
          ["/reports", "รายงาน", "▥"]
        ]
      : [
          ["/", "ภาพรวม", "⌂"],
          ["/marketing", "การตลาด", "↗"],
          ["/documents", "เอกสาร", "▤"]
        ];

  return (
    <nav className="bottomNav" aria-label="เมนูหลัก">
      {items.map(([href, label, icon]) => (
        <Link href={href} key={href} className="navItem">
          <span className="navIcon" aria-hidden>{icon}</span>
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
