// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppPreferencesProvider } from "@/components/AppPreferences";
import { SearchResults } from "@/components/SearchResults";
import type { MeetingSearchResponse } from "@/lib/meetingSearch";

vi.mock("@/components/RecorderNavigation", () => ({
  GuardedLink: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

const response: MeetingSearchResponse = {
  query: "설정",
  hasMore: false,
  summaryPendingCount: 0,
  index: { status: "ready", reasons: [], reindexable: false },
  results: [{
    meetingId: "meeting-1",
    title: "설정",
    status: "summarized",
    startedAt: "2026-07-28T00:00:00.000Z",
    location: null,
    matches: [{ field: "title", label: "제목", excerpt: "설정" }],
    href: "/meetings/meeting-1",
  }],
};

describe("SearchResults localization boundary", () => {
  beforeEach(() => {
    window.localStorage.setItem("ai-note-locale", "en");
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    })));
  });

  it("preserves user title and excerpt while translating fixed fallback and match labels", async () => {
    render(
      <AppPreferencesProvider>
        <SearchResults response={response} activeFilterCount={0} onResetFilters={vi.fn()} />
      </AppPreferencesProvider>,
    );

    await waitFor(() => expect(screen.getByText("Location needs verification")).toBeInTheDocument());
    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getAllByText("설정")).toHaveLength(2);
    expect(screen.queryByText("Settings")).not.toBeInTheDocument();
  });
});
