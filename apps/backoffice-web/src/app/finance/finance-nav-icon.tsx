import type { ReactNode } from "react";

export type FinanceNavIconName =
  | "finance" | "more" | "settings" | "sales" | "receipt" | "tax" | "products"
  | "list" | "package" | "logout" | "store" | "branches" | "devices" | "printer"
  | "activity" | "payments" | "notifications" | "support" | "language"
  | "layout" | "display" | "qr" | "palette";

export function FinanceNavIcon({
  name, className = "h-[18px] w-[18px]"
}: {
  name: FinanceNavIconName;
  className?: string;
}) {
  const icons: Record<FinanceNavIconName, ReactNode> = {
    finance: <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M7 15l3-4 3 2 4-6M7 18h10" /></>,
    more: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    settings: <><path d="M9.7 3.5l.6-1h3.4l.6 1 1.3 1 1.4-.3 2.4 2.4-.3 1.4 1 1.3 1.1.6v3.4l-1.1.6-1 1.3.3 1.4-2.4 2.4-1.4-.3-1.3 1-.6 1h-3.4l-.6-1-1.3-1-1.4.3-2.4-2.4.3-1.4-1-1.3-1.1-.6V9.9l1.1-.6 1-1.3-.3-1.4 2.4-2.4 1.4.3z" /><circle cx="12" cy="12" r="3" /></>,
    sales: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h4" /></>,
    receipt: <><path d="M5 3h14v18l-3-2-3 2-3-2-3 2-2-2zM9 8h6M9 12h6M9 16h3" /></>,
    tax: <><path d="M5 3h10l4 4v14H5zM15 3v5h4M8 12h8M8 16h8" /><path d="M9 8h2" /></>,
    products: <><path d="M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10M8 5l9 4" /></>,
    list: <><path d="M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1" /></>,
    package: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M3 9h18M7 15h4" /></>,
    logout: <><path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M14 7l5 5-5 5M19 12H9" /></>,
    store: <><path d="M3 10l2-6h14l2 6v10H3zM3 10c1.5 2 3 2 4.5 0 1.5 2 3 2 4.5 0 1.5 2 3 2 4.5 0 1.5 2 3 2 4.5 0M9 20v-7h6v7" /></>,
    branches: <><rect x="9" y="2" width="6" height="6" rx="1" /><rect x="2" y="16" width="6" height="6" rx="1" /><rect x="16" y="16" width="6" height="6" rx="1" /><path d="M12 8v5M5 16v-3h14v3" /></>,
    devices: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>,
    printer: <><path d="M6 9V3h12v6M6 18H4V9h16v9h-2M6 15h12v6H6zM17 12h.1" /></>,
    activity: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2M3 12h3" /></>,
    payments: <><rect x="2" y="5" width="20" height="14" rx="3" /><path d="M2 9h20M6 15h5" /></>,
    notifications: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
    support: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 4.5 1.5c-1.5 1-2 1.6-2 3M12 17h.1" /></>,
    language: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c-5 5-5 13 0 18M12 3c5 5 5 13 0 18" /></>,
    layout: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 9v12" /></>,
    display: <><rect x="2" y="4" width="20" height="14" rx="2" /><path d="M8 22h8M12 18v4" /></>,
    qr: <><path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM21 14v3M17 21h4M14 21v-2" /></>,
    palette: <><path d="M12 3a9 9 0 0 0 0 18h2a2 2 0 0 0 1-4 2 2 0 0 1 1-3h2a4 4 0 0 0 4-4 10 10 0 0 0-10-7z" /><circle cx="7" cy="11" r="1" /><circle cx="10" cy="7" r="1" /><circle cx="16" cy="8" r="1" /></>
  };
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      className={"shrink-0 " + className}>
      {icons[name]}
    </svg>
  );
}
