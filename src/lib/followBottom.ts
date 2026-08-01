// Follow-bottom autoscroll policy for live, append-only transcript panes.
//
// A viewport is "following the bottom" when its scroll position sits within a
// small threshold of the end of the content. While following, new content should
// autoscroll into view; once the user scrolls up beyond the threshold to read
// history, following stops so incoming content never yanks them back down.

/** Distance (px) from the exact bottom still counted as "following". */
export const FOLLOW_BOTTOM_THRESHOLD_PX = 48;

export interface ScrollMetrics {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

export function isFollowingBottom(
  metrics: ScrollMetrics,
  threshold: number = FOLLOW_BOTTOM_THRESHOLD_PX,
): boolean {
  const distanceFromBottom = metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop;
  return distanceFromBottom <= threshold;
}
