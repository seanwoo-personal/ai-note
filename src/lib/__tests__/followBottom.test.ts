// @vitest-environment node
import { describe, expect, it } from "vitest";

import { FOLLOW_BOTTOM_THRESHOLD_PX, isFollowingBottom } from "@/lib/followBottom";

describe("isFollowingBottom", () => {
  it("follows when the viewport is pinned to the exact bottom", () => {
    expect(isFollowingBottom({ scrollTop: 400, clientHeight: 100, scrollHeight: 500 })).toBe(true);
  });

  it("follows while within the threshold distance of the bottom", () => {
    // distance = 500 - 100 - (500 - 100 - FOLLOW_BOTTOM_THRESHOLD_PX) = FOLLOW_BOTTOM_THRESHOLD_PX
    const scrollTop = 500 - 100 - FOLLOW_BOTTOM_THRESHOLD_PX;
    expect(isFollowingBottom({ scrollTop, clientHeight: 100, scrollHeight: 500 })).toBe(true);
  });

  it("stops following once the user scrolls up beyond the threshold", () => {
    const scrollTop = 500 - 100 - FOLLOW_BOTTOM_THRESHOLD_PX - 1;
    expect(isFollowingBottom({ scrollTop, clientHeight: 100, scrollHeight: 500 })).toBe(false);
  });

  it("treats non-overflowing content as following the bottom", () => {
    expect(isFollowingBottom({ scrollTop: 0, clientHeight: 200, scrollHeight: 120 })).toBe(true);
  });

  it("honors an explicit threshold override", () => {
    expect(isFollowingBottom({ scrollTop: 0, clientHeight: 100, scrollHeight: 500 }, 400)).toBe(true);
    expect(isFollowingBottom({ scrollTop: 0, clientHeight: 100, scrollHeight: 500 }, 399)).toBe(false);
  });

  it("exposes a positive default threshold", () => {
    expect(FOLLOW_BOTTOM_THRESHOLD_PX).toBeGreaterThan(0);
  });
});
