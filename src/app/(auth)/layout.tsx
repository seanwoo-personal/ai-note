import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppPreferencesProvider } from "@/components/AppPreferences";
import { APP_PREFERENCES_BOOTSTRAP_SCRIPT } from "@/lib/appPreferences";
import { ANDROID_APP_BOOTSTRAP_SCRIPT } from "@/lib/androidAppBootstrap";
import { BRAND_PRODUCT_NAME } from "@/lib/brand";
import "../globals.css";

export const metadata: Metadata = {
  title: `${BRAND_PRODUCT_NAME} 로그인`,
  description: "승인된 고객과 운영자를 위한 로그인",
};

export default function AuthLayout({ children }: { children: ReactNode }) {
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
