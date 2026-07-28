// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HomeQuickStart } from "@/components/HomeClient";

const recorder = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("@/components/Recorder", () => ({
  Recorder: (props: unknown) => {
    recorder.render(props);
    return <section><h2>새 회의 녹음</h2></section>;
  },
}));
vi.mock("@/components/RecorderNavigation", () => ({
  GuardedLink: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

describe("HomeQuickStart", () => {
  it("keeps the original recording entry point and all Soniox tools on the recent-document home", () => {
    render(<HomeQuickStart workspaceId="workspace-a" />);

    expect(screen.getByRole("heading", { name: "새 회의 녹음" })).toBeInTheDocument();
    expect(recorder.render).toHaveBeenCalledWith(expect.objectContaining({
      requestedLocation: { workspaceId: "workspace-a", folderId: null },
    }));
    expect(screen.getByRole("link", { name: "Smart Scribe 열기" })).toHaveAttribute(
      "href",
      "/soniox?workspace=workspace-a&tool=transcription",
    );
    expect(screen.getByRole("link", { name: "Translator 열기" })).toHaveAttribute(
      "href",
      "/soniox?workspace=workspace-a&tool=translator",
    );
    expect(screen.getByRole("link", { name: "Voice Typing 열기" })).toHaveAttribute(
      "href",
      "/soniox?workspace=workspace-a&tool=voice-typing",
    );
  });
});
