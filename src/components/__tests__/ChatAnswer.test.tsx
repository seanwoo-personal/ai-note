// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppPreferencesProvider } from "@/components/AppPreferences";
import { ChatAnswer } from "@/components/ChatAnswer";
import type { ChatResponse } from "@/domain/chat";

vi.mock("@/components/RecorderNavigation", () => ({
  GuardedLink: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

const answer: ChatResponse = {
  answerSegments: [{
    kind: "claim",
    format: "paragraph",
    text: "사용자 답변",
    referenceNumbers: [1],
  }],
  references: [{
    number: 1,
    meetingId: "meeting-1",
    currentTitle: "설정",
    startedAt: "2026-07-28T00:00:00.000Z",
    href: "/meetings/meeting-1",
  }],
  evidenceStatus: "sufficient",
  checkedScope: {
    searchResults: 1,
    knowledgeCards: 1,
    summaries: 1,
    transcriptWindows: 0,
    fullTranscripts: 0,
    distinctMeetings: 1,
  },
  warnings: [],
};

describe("ChatAnswer localization boundary", () => {
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

  it("localizes the citation prefix while preserving the user-authored meeting title", async () => {
    render(
      <AppPreferencesProvider>
        <ChatAnswer
          answer={answer}
          answerKey="answer-1"
          mode="normal"
          canDeep={false}
          busy={false}
          onDeep={vi.fn()}
          onSearchReplay={vi.fn()}
          onSwitchToSearch={vi.fn()}
          onUpdateSearchData={vi.fn()}
        />
      </AppPreferencesProvider>,
    );

    expect(await screen.findByRole("link", { name: "Source 1: 설정" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Source 1: Settings" })).not.toBeInTheDocument();
  });
});
