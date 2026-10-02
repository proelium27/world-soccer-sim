/**
 * Whether this browser is short enough of memory that a long sim should be
 * split (see core/simChunks.ts).
 *
 * Splitting costs a save per chunk, which made a full season ~40% slower on a
 * desktop that never needed it, and the results are identical either way — so
 * only the devices that run out of memory pay for it. That is phones and
 * tablets (a tab there is killed somewhere under ~1 GB, and the season sim
 * peaked at 1.4 GB), plus any browser that reports 4 GB of RAM or less.
 *
 * Read once per call rather than cached, so a test can stub `navigator`.
 */
export function isLowMemoryDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    userAgentData?: { mobile?: boolean };
  };
  if (nav.userAgentData?.mobile) return true;
  if (typeof nav.deviceMemory === "number" && nav.deviceMemory <= 4) return true;
  const ua = nav.userAgent ?? "";
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
  // iPadOS asks for the desktop site and reports itself as a Mac; a touch
  // screen is what gives it away.
  return /Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
}
