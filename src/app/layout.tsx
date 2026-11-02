import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Kist", template: "%s | Kist" },
  description: "Field collections for Company A: today's priority list, outcome logging that works offline, and roll rates by branch.",
  applicationName: "Kist",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f3f5f1",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="hi-IN">
      <body>{children}</body>
    </html>
  );
}
