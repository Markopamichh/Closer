import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import type { ReactNode } from "react";
import "./globals.css";
import { Geist } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { themeScript } from "@/lib/theme";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Closer",
  description: "AI sales agent for your business",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    // The inline theme script sets the class on <html> before hydration.
    <html lang={locale} className={cn("font-sans", geist.variable)} suppressHydrationWarning>
      <head>
        {/* A constant string, no user input: safe to inline. */}
        <script dangerouslySetInnerHTML={{ __html: themeScript() }} />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <NextIntlClientProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
