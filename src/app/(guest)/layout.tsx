import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppPreferencesProvider } from "@/components/AppPreferences";
import { APP_PREFERENCES_BOOTSTRAP_SCRIPT } from "@/lib/appPreferences";
import { ANDROID_APP_BOOTSTRAP_SCRIPT } from "@/lib/androidAppBootstrap";
import { BRAND_PRODUCT_NAME } from "@/lib/brand";
import "../globals.css";

export const metadata: Metadata = {
  title: `${BRAND_PRODUCT_NAME} 통역 회의실`,
  description: "초대받은 통역 회의실",
};

// Minimal shell for invited guests: no library rail, search, or settings.
export default function GuestLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APP_PREFERENCES_BOOTSTRAP_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: ANDROID_APP_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-bg font-sans text-ink antialiased">
        <AppPreferencesProvider>{children}</AppPreferencesProvider>
      </body>
    </html>
  );
}
