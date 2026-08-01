/**
 * Pure, dependency-free scroll "follow" state machine for a live meeting
 * transcript / translation view.
 *
 * States:
 *  - "follow":       the viewport tracks the newest content; every update jumps
 *                    the container to the bottom.
 *  - "user-reading": the user has scrolled up to read earlier content; new
 *                    updates must NEVER force-scroll while they read.
 *
 * "resume" is not a stored state — it is the transition back to "follow" caused
 * either by the user scrolling back near the bottom or by an explicit
 * resume-request ("latest"/"bottom") action.
 *
 * The reducer is intentionally pure: no Date, no Math.random, no DOM access.
 */

export type ScrollFollowState = "follow" | "user-reading";

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** Distance in px from the bottom within which we treat the viewport as "at bottom". */
export const NEAR_BOTTOM_THRESHOLD_PX = 48;

/**
 * Pixels between the current scroll position and the bottom of the scrollable
 * content: `scrollHeight - clientHeight - scrollTop`, clamped to `>= 0` so
 * overscroll / rounding never yields a negative distance.
 */
export function distanceFromBottom(metrics: ScrollMetrics): number {
  const raw = metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop;
  return raw > 0 ? raw : 0;
}

/**
 * True when the viewport is within `threshold` px of the bottom
 * (default {@link NEAR_BOTTOM_THRESHOLD_PX}). Exactly at the threshold counts
 * as near.
 */
export function isNearBottom(
  metrics: ScrollMetrics,
  threshold: number = NEAR_BOTTOM_THRESHOLD_PX,
): boolean {
  return distanceFromBottom(metrics) <= threshold;
}

export type ScrollFollowEvent =
  /** Transcript/translation content was appended. */
  | { type: "content-updated" }
  /** The user (or a programmatic scroll) moved the container; metrics are post-scroll. */
  | { type: "user-scroll"; metrics: ScrollMetrics }
  /** Explicit "latest"/"bottom" action. */
  | { type: "resume-request" }
  /** A new meeting session begins; prior follow/gesture state must not leak. */
  | { type: "reset-session" };

export interface ScrollFollowResult {
  state: ScrollFollowState;
  /** True when the caller should imperatively scroll the container to the bottom this tick. */
  scrollToBottom: boolean;
}

/** Initial machine value: following, with no pending scroll. */
export function initialScrollFollow(): ScrollFollowResult {
  return { state: "follow", scrollToBottom: false };
}

/**
 * Deterministic transition for the scroll-follow machine.
 *
 * NOTE: There is deliberately NO time-based event. Time alone can never resume
 * follow — the only transitions back to "follow" are a user-scroll that lands
 * near the bottom or an explicit resume-request. content-updated events (which
 * arrive continuously as new transcript streams in) must never resume follow.
 */
export function reduceScrollFollow(
  state: ScrollFollowState,
  event: ScrollFollowEvent,
): ScrollFollowResult {
  switch (event.type) {
    case "reset-session":
      return initialScrollFollow();

    case "resume-request":
      // Explicit "latest"/"bottom" always resumes following AND jumps to bottom.
      return { state: "follow", scrollToBottom: true };

    case "content-updated":
      // While following, every update jumps to the newest content. While
      // reading, updates must never force-scroll and never change state.
      return state === "follow"
        ? { state: "follow", scrollToBottom: true }
        : { state: "user-reading", scrollToBottom: false };

    case "user-scroll":
      // Landing near the bottom (re)enters/keeps follow; scrolling up enters
      // (or keeps) user-reading. A user-scroll never itself requests a scroll.
      return isNearBottom(event.metrics)
        ? { state: "follow", scrollToBottom: false }
        : { state: "user-reading", scrollToBottom: false };
  }
}
