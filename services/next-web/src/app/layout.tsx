import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { TraderProvider } from "@/components/trader-provider";
import { themeBootScript } from "@/lib/theme";
import "./globals.css";

const sans = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Mock Trader",
  description: "Practice trading on NSE with virtual money.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={sans.variable} suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static theme bootstrap */}
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>
        <TraderProvider>
          <AppShell>{children}</AppShell>
        </TraderProvider>
      </body>
    </html>
  );
}
