import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Geist } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Closer",
  description: "AI sales agent for your business",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // next-themes sets the class on <html> before hydration.
    <html lang="en" className={cn("font-sans", geist.variable)} suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
