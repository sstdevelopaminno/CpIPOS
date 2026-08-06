import type { Metadata, Viewport } from "next";
import { MobileNotificationBar } from "@/components/layout/mobile-notification-bar";
import "./globals.css";

export const metadata: Metadata = {
  title: "CpIPOS Mobile",
  description: "Mobile-first POS companion for CpIPOS",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "CpIPOS",
  },
  icons: {
    icon: [
      { url: "/brand/cpipos-icon-transparent-192.png", sizes: "192x192", type: "image/png" },
      { url: "/brand/cpipos-icon-transparent-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/brand/cpipos-icon-transparent-180.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#061b33"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>
        <MobileNotificationBar />
        {children}
      </body>
    </html>
  );
}
