import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { ChatPanel } from "@/components/ChatPanel";
import { AppPreferencesProvider, LocalizedText } from "@/components/AppPreferences";
import { LibraryProvider } from "@/components/LibraryProvider";
import { LibraryNavigation } from "@/components/LibraryNavigation";
import { RecorderSessionProvider } from "@/components/RecorderSessionProvider";
import { MEETING_ASSISTANT_ENABLED } from "@/lib/features";
import { APP_PREFERENCES_BOOTSTRAP_SCRIPT } from "@/lib/appPreferences";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vision AI 미팅 에이전트",
  description: "회의 녹음, 실시간 전사·번역, 회의록 요약",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APP_PREFERENCES_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-bg font-sans text-ink antialiased lg:h-dvh lg:overflow-hidden">
        <AppPreferencesProvider>
          {/* Skip past the persistent nav straight to the page's <main id="main">. */}
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-ink focus:px-4 focus:py-2 focus:text-[13px] focus:font-semibold focus:text-bg"
          >
            <LocalizedText source="본문으로 건너뛰기" />
          </a>
          <LibraryProvider>
            <RecorderSessionProvider>
              <div className="flex min-h-screen w-full flex-col lg:h-dvh lg:min-h-0 lg:flex-row lg:overflow-hidden">
                <Suspense fallback={<div className="h-16 w-full border-b border-line bg-chrome lg:h-dvh lg:min-h-0 lg:w-[272px] lg:border-b-0 lg:border-r" />}>
                  <LibraryNavigation />
                </Suspense>
                <div id="app-content" className="min-w-0 flex-1 lg:h-dvh lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain">{children}</div>
                {MEETING_ASSISTANT_ENABLED && <ChatPanel />}
              </div>
            </RecorderSessionProvider>
          </LibraryProvider>
        </AppPreferencesProvider>
      </body>
    </html>
  );
}
