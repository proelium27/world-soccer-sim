import { useEffect, useState } from "react";

/** The mobile breakpoint the responsive CSS uses. */
const MOBILE_QUERY = "(max-width: 767.98px)";

/**
 * True while the viewport matches `query`. Client-only app, so matchMedia is
 * safe; updates on viewport resize / orientation change.
 *
 * Exported separately from `useIsMobile` because not every "is there room for
 * this" question is the mobile question: the match pitch draws two elevens side
 * by side and runs out of width long before a phone (see MatchPitch), so it
 * asks about its own threshold rather than borrowing one that means something
 * else.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", onChange);
    // Sync in case the viewport changed between initial state and mount.
    setMatches(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/**
 * True while the viewport is at or below the mobile breakpoint (the same
 * 767.98px cutoff the responsive CSS uses).
 */
export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY);
}
