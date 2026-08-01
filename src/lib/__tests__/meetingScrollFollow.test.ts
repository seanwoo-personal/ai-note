// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  NEAR_BOTTOM_THRESHOLD_PX,
  type ScrollFollowEvent,
  type ScrollFollowState,
  type ScrollMetrics,
  distanceFromBottom,
  initialScrollFollow,
  isNearBottom,
  reduceScrollFollow,
} from "@/lib/meetingScrollFollow";

/** Metrics whose distance-from-bottom is exactly `distance` px. */
function metricsAtDistance(distance: number): ScrollMetrics {
  const clientHeight = 400;
  const scrollHeight = 2000;
  // scrollHeight - clientHeight - scrollTop === distance
  const scrollTop = scrollHeight - clientHeight - distance;
  return { scrollTop, scrollHeight, clientHeight };
}

describe("distanceFromBottom", () => {
  it("computes scrollHeight - clientHeight - scrollTop", () => {
    expect(
      distanceFromBottom({ scrollTop: 500, scrollHeight: 2000, clientHeight: 400 }),
    ).toBe(1100);
  });

  it("is 0 exactly at the bottom", () => {
    expect(
      distanceFromBottom({ scrollTop: 1600, scrollHeight: 2000, clientHeight: 400 }),
    ).toBe(0);
  });

  it("clamps to 0 when overscrolled (never negative)", () => {
    expect(
      distanceFromBottom({ scrollTop: 5000, scrollHeight: 2000, clientHeight: 400 }),
    ).toBe(0);
  });
});

describe("isNearBottom", () => {
  it("treats distance below the threshold as near", () => {
    expect(isNearBottom(metricsAtDistance(NEAR_BOTTOM_THRESHOLD_PX - 10))).toBe(true);
  });

  it("boundary: exactly at threshold is near", () => {
    expect(isNearBottom(metricsAtDistance(NEAR_BOTTOM_THRESHOLD_PX))).toBe(true);
  });

  it("boundary: threshold + 1 is NOT near", () => {
    expect(isNearBottom(metricsAtDistance(NEAR_BOTTOM_THRESHOLD_PX + 1))).toBe(false);
  });

  it("honours a custom threshold argument", () => {
    expect(isNearBottom(metricsAtDistance(100), 100)).toBe(true);
    expect(isNearBottom(metricsAtDistance(101), 100)).toBe(false);
  });
});

describe("initialScrollFollow", () => {
  it("starts in follow with no scroll requested", () => {
    expect(initialScrollFollow()).toEqual({ state: "follow", scrollToBottom: false });
  });
});

describe("reduceScrollFollow — follow state", () => {
  it("follow + content-updated jumps to bottom and stays following", () => {
    expect(reduceScrollFollow("follow", { type: "content-updated" })).toEqual({
      state: "follow",
      scrollToBottom: true,
    });
  });

  it("stays following across repeated content-updated (scrollToBottom stays true)", () => {
    let state: ScrollFollowState = "follow";
    for (let i = 0; i < 5; i += 1) {
      const result = reduceScrollFollow(state, { type: "content-updated" });
      expect(result).toEqual({ state: "follow", scrollToBottom: true });
      state = result.state;
    }
  });

  it("follow + user-scroll near bottom stays in follow (no scroll)", () => {
    const event: ScrollFollowEvent = {
      type: "user-scroll",
      metrics: metricsAtDistance(NEAR_BOTTOM_THRESHOLD_PX),
    };
    expect(reduceScrollFollow("follow", event)).toEqual({
      state: "follow",
      scrollToBottom: false,
    });
  });

  it("follow + user-scroll up enters user-reading (no scroll)", () => {
    const event: ScrollFollowEvent = {
      type: "user-scroll",
      metrics: metricsAtDistance(NEAR_BOTTOM_THRESHOLD_PX + 1),
    };
    expect(reduceScrollFollow("follow", event)).toEqual({
      state: "user-reading",
      scrollToBottom: false,
    });
  });
});

describe("reduceScrollFollow — user-reading state", () => {
  it("user-reading + content-updated NEVER force-scrolls", () => {
    expect(reduceScrollFollow("user-reading", { type: "content-updated" })).toEqual({
      state: "user-reading",
      scrollToBottom: false,
    });
  });

  it("repeated content-updated while reading never scrolls (scrollToBottom false each time)", () => {
    let state: ScrollFollowState = "user-reading";
    for (let i = 0; i < 5; i += 1) {
      const result = reduceScrollFollow(state, { type: "content-updated" });
      expect(result).toEqual({ state: "user-reading", scrollToBottom: false });
      state = result.state;
    }
  });

  it("user-reading + user-scroll still up stays reading", () => {
    const event: ScrollFollowEvent = {
      type: "user-scroll",
      metrics: metricsAtDistance(NEAR_BOTTOM_THRESHOLD_PX + 200),
    };
    expect(reduceScrollFollow("user-reading", event)).toEqual({
      state: "user-reading",
      scrollToBottom: false,
    });
  });

  it("user-reading + user-scroll back to bottom RESUMES follow (no scroll on this tick)", () => {
    const event: ScrollFollowEvent = {
      type: "user-scroll",
      metrics: metricsAtDistance(0),
    };
    expect(reduceScrollFollow("user-reading", event)).toEqual({
      state: "follow",
      scrollToBottom: false,
    });
  });

  it("resuming via user-scroll then continuous updates keep following", () => {
    const resumed = reduceScrollFollow("user-reading", {
      type: "user-scroll",
      metrics: metricsAtDistance(0),
    });
    expect(resumed).toEqual({ state: "follow", scrollToBottom: false });

    // Subsequent content-updated scrolls to bottom again — follow is truly resumed.
    let state: ScrollFollowState = resumed.state;
    for (let i = 0; i < 3; i += 1) {
      const result = reduceScrollFollow(state, { type: "content-updated" });
      expect(result).toEqual({ state: "follow", scrollToBottom: true });
      state = result.state;
    }
  });
});

describe("reduceScrollFollow — resume-request", () => {
  it("resume-request from user-reading returns follow + scrollToBottom true", () => {
    expect(reduceScrollFollow("user-reading", { type: "resume-request" })).toEqual({
      state: "follow",
      scrollToBottom: true,
    });
  });

  it("resume-request from follow stays follow + scrollToBottom true", () => {
    expect(reduceScrollFollow("follow", { type: "resume-request" })).toEqual({
      state: "follow",
      scrollToBottom: true,
    });
  });

  it("after resume-request, a following content-updated keeps following", () => {
    const resumed = reduceScrollFollow("user-reading", { type: "resume-request" });
    expect(resumed.state).toBe("follow");
    expect(reduceScrollFollow(resumed.state, { type: "content-updated" })).toEqual({
      state: "follow",
      scrollToBottom: true,
    });
  });
});

describe("reduceScrollFollow — reset-session", () => {
  it("drops a prior user-reading state without carrying a pending scroll into the new session", () => {
    expect(reduceScrollFollow("user-reading", { type: "reset-session" })).toEqual({
      state: "follow",
      scrollToBottom: false,
    });
  });
});

describe("reduceScrollFollow — time can never resume", () => {
  it("only user-scroll-near-bottom or resume-request move user-reading -> follow", () => {
    // There is deliberately no time-based event. content-updated is the event that
    // fires as new transcript arrives over time; it must NOT resume follow. This
    // proves that the mere passage of time / arrival of content cannot resume.
    let state: ScrollFollowState = "user-reading";
    for (let i = 0; i < 20; i += 1) {
      const result = reduceScrollFollow(state, { type: "content-updated" });
      expect(result.state).toBe("user-reading");
      expect(result.scrollToBottom).toBe(false);
      state = result.state;
    }

    // The ONLY escapes back to follow:
    expect(
      reduceScrollFollow("user-reading", {
        type: "user-scroll",
        metrics: metricsAtDistance(0),
      }).state,
    ).toBe("follow");
    expect(
      reduceScrollFollow("user-reading", { type: "resume-request" }).state,
    ).toBe("follow");
  });
});
