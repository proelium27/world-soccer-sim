import { describe, it, expect, afterEach, vi } from "vitest";
import { isLowMemoryDevice } from "../../src/ui/lowMemoryDevice.js";

const DESKTOP_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

function withNavigator(nav: Record<string, unknown>): void {
  vi.stubGlobal("navigator", { maxTouchPoints: 0, ...nav });
}

describe("isLowMemoryDevice", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps a desktop on the single round trip", () => {
    withNavigator({ userAgent: DESKTOP_CHROME, deviceMemory: 8 });
    expect(isLowMemoryDevice()).toBe(false);
  });

  it("splits on phones and tablets", () => {
    withNavigator({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148" });
    expect(isLowMemoryDevice()).toBe(true);
    withNavigator({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/140.0 Mobile Safari/537.36" });
    expect(isLowMemoryDevice()).toBe(true);
    withNavigator({ userAgent: DESKTOP_CHROME, userAgentData: { mobile: true } });
    expect(isLowMemoryDevice()).toBe(true);
  });

  it("catches an iPad asking for the desktop site", () => {
    withNavigator({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.0 Safari/605.1.15", maxTouchPoints: 5 });
    expect(isLowMemoryDevice()).toBe(true);
  });

  it("splits on a small-memory desktop too", () => {
    withNavigator({ userAgent: DESKTOP_CHROME, deviceMemory: 4 });
    expect(isLowMemoryDevice()).toBe(true);
  });
});
