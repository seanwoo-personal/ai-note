// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSonioxConnection } from "@/components/useSonioxConnection";
import { sonioxConnectionStore } from "@/services/sonioxConnectionStore";

describe("useSonioxConnection", () => {
  beforeEach(() => {
    sonioxConnectionStore.reset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    sonioxConnectionStore.reset();
  });

  it("returns the current disconnected snapshot on first render", () => {
    const { result } = renderHook(() => useSonioxConnection());
    expect(result.current).toEqual({ status: "disconnected", session: 0 });
  });

  it("re-renders immediately on store lifecycle events (no polling)", () => {
    const { result } = renderHook(() => useSonioxConnection());
    act(() => {
      const session = sonioxConnectionStore.beginSession();
      session.connected();
    });
    expect(result.current.status).toBe("connected");
    act(() => {
      sonioxConnectionStore.reset();
    });
    expect(result.current.status).toBe("disconnected");
  });

  it("subscribes on mount and unsubscribes on unmount (cleanup)", () => {
    const unsubscribe = vi.fn();
    const subscribeSpy = vi
      .spyOn(sonioxConnectionStore, "subscribe")
      .mockImplementation(() => unsubscribe);
    const { unmount } = renderHook(() => useSonioxConnection());
    expect(subscribeSpy).toHaveBeenCalledTimes(1);
    expect(unsubscribe).not.toHaveBeenCalled();
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
