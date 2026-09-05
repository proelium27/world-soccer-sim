import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { makeLeague } from "../helpers/league.js";
import { JumpOverlay } from "../../src/ui/components/JumpOverlay.js";
import { JumpSeasonsForm } from "../../src/ui/components/JumpSeasonsForm.js";
import { MAX_JUMP_SEASONS } from "../../src/core/autopilot.js";
import { SPECTATOR_TID } from "../../src/core/spectator.js";

/**
 * Render harness for the two jump surfaces. Both are reachable only after a
 * several-minute worker run, so a throw in either is the worst possible place
 * to find one: the seasons are already played and committed, and the user is
 * looking at a blank screen instead of their recap.
 *
 * Server rendering does not run error boundaries (React re-throws to the
 * caller), so a throw here surfaces as a test failure.
 */
describe("jump surfaces render", () => {
  it("renders the form and its confirm-first state", () => {
    const html = renderToStaticMarkup(
      createElement(JumpSeasonsForm, { season: 12, disabled: false, onJump: () => {} }),
    );
    // The season the user would land in, resolved from the default entry.
    expect(html).toContain("2042");
    expect(html).toContain(String(MAX_JUMP_SEASONS));
  });

  it("renders the progress state", () => {
    const html = renderToStaticMarkup(
      createElement(JumpOverlay, {
        open: true,
        progress: { seasonsDone: 2, totalSeasons: 5, season: 3 },
        result: null,
        onClose: () => {},
      }),
    );
    expect(html).toContain("season 3 of 5");
  });

  it("renders the recap against a league with no history to show", () => {
    // The honest edge case: jumping from season 1 means seasonHistory has
    // nothing for the jumped seasons yet on a freshly built league, so the
    // recap must degrade to a sentence rather than an empty table.
    const league = makeLeague(0, 1);
    const html = renderToStaticMarkup(
      createElement(JumpOverlay, {
        open: true,
        progress: { seasonsDone: 1, totalSeasons: 1, season: 1 },
        result: { league, managedSeasons: [1] },
        onClose: () => {},
      }),
    );
    expect(html).toContain("Welcome back");
    expect(html).toContain("Take over");
    // The recap covers the user's club; Season History covers the rest of the
    // world, and taking over goes there. Saying so beats a silent redirect.
    expect(html).toContain("Season History");
    expect(html).toContain("Roster");
  });

  it("says nothing about a squad or a Roster on a spectator save", () => {
    // A spectator can jump like anyone else (beginAutopilot just swaps one
    // club-less sentinel for another), and has no squad to be handed back and
    // no Roster page to be sent to — ClubOnly would bounce them off it.
    const base = makeLeague(0, 1);
    const league = { ...base, meta: { ...base.meta, userTid: SPECTATOR_TID } };
    const html = renderToStaticMarkup(
      createElement(JumpOverlay, {
        open: true,
        progress: { seasonsDone: 1, totalSeasons: 1, season: 1 },
        result: { league, managedSeasons: [1] },
        onClose: () => {},
      }),
    );
    expect(html).not.toContain("Roster");
    expect(html).not.toContain("Your club");
    // The half that still applies: the world played on, and here is where to read it.
    expect(html).toContain("Season History");
  });

  it("renders nothing when closed", () => {
    const html = renderToStaticMarkup(
      createElement(JumpOverlay, { open: false, progress: null, result: null, onClose: () => {} }),
    );
    expect(html).toBe("");
  });
});
