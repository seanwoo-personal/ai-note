import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/InterpreterRoom", () => ({
  ROOM_INVITE_STORAGE_PREFIX: "ai-note-room-invite:",
  InterpreterRoom: ({ roomId, role }: { roomId: string; role: string }) => <div data-testid="room">{role}:{roomId}</div>,
}));

import { AppPreferencesProvider } from "@/components/AppPreferences";
import { GuestJoinClient } from "@/components/GuestJoinClient";
import { RoomCreateClient } from "@/components/RoomCreateClient";

function renderWithPreferences(node: React.ReactElement) {
  return render(<AppPreferencesProvider>{node}</AppPreferencesProvider>);
}

describe("interpreter room entry screens", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    window.localStorage.setItem("ai-note-locale", "ko");
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("offers mode and language choices with video call as the default and Japanese-first language order", () => {
    renderWithPreferences(<RoomCreateClient />);
    expect(screen.getByRole("radio", { name: /화상회의/u })).toBeChecked();
    expect(screen.getByRole("radio", { name: /같은 방/u })).not.toBeChecked();
    const options = screen.getAllByRole("option").map((option) => option.textContent);
    expect(options.slice(0, 4)).toEqual(["한국어", "English", "日本語", "中文"]);
    expect(screen.getByRole("button", { name: "만들기" })).toBeEnabled();
  });

  it("shows the join form when no guest session exists and enters the room after a successful join", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "authentication_required" } }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "room-1", room: {} }), { status: 200 }));
    renderWithPreferences(<GuestJoinClient token="invite-token-with-enough-length" />);

    await screen.findByRole("heading", { name: "회의실에 입장하기" });
    const enter = screen.getByRole("button", { name: "입장" });
    expect(enter).toBeDisabled();
    fireEvent.change(screen.getByLabelText("이름"), { target: { value: "Alex" } });
    fireEvent.change(screen.getByLabelText("비밀번호"), { target: { value: "Kx7pQ2mR" } });
    expect(enter).toBeEnabled();
    fireEvent.click(enter);

    await waitFor(() => expect(screen.getByTestId("room")).toHaveTextContent("guest:room-1"));
    const [, joinCall] = fetchMock.mock.calls;
    expect(joinCall[0]).toBe("/api/rooms/join/invite-token-with-enough-length");
    expect(JSON.parse((joinCall[1] as RequestInit).body as string)).toMatchObject({ name: "Alex", password: "Kx7pQ2mR" });
  });

  it("offers a returning guest to continue or re-enter, and shows a dead end for an unknown link", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ state: "session", id: "room-9", name: "Alex", language: "en" }), { status: 200 }));
    const { unmount } = renderWithPreferences(<GuestJoinClient token="invite-token-with-enough-length" />);
    await screen.findByText("이전에 Alex 이름으로 입장한 기록이 있습니다.");
    fireEvent.click(screen.getByRole("button", { name: "다른 이름으로 입장" }));
    expect(screen.getByLabelText("이름")).toHaveValue("");
    unmount();

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ state: "session", id: "room-9", name: "Alex", language: "en" }), { status: 200 }));
    const second = renderWithPreferences(<GuestJoinClient token="invite-token-with-enough-length" />);
    fireEvent.click(await screen.findByRole("button", { name: "같은 이름으로 계속" }));
    await waitFor(() => expect(screen.getByTestId("room")).toHaveTextContent("guest:room-9"));
    second.unmount();

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    renderWithPreferences(<GuestJoinClient token="unknown-token-with-enough-length" />);
    await screen.findByRole("heading", { name: "잘못된 접근입니다" });
    expect(screen.queryByLabelText("이름")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("이 링크로는 열 수 있는 회의실이 없습니다.");
  });
});
