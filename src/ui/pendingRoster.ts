import type { NamedRosterFile } from "../core/teams/rosterFile.js";
import type { NamedLogoPack } from "../core/teams/logoPack.js";

/**
 * One-shot handoff of the parsed roster files from the Leagues page's Import
 * button to the new-league flow that consumes them.
 *
 * A module variable rather than router state because a roster file carrying
 * real squads runs to several megabytes (the FC26 world is ~3.6 MB), and
 * history state is neither meant for nor reliably sized for that. It is taken
 * exactly once so a later visit to /new-league can't pick up a stale file; if
 * the handoff is missed — a hard refresh drops it — the page just shows its own
 * file picker, which is the same screen the user would have seen anyway.
 *
 * Several files rather than one: a world is normally authored a league at a
 * time (see combineRosterFiles), so the picker takes as many as the user
 * selected and the next screen can keep adding to them.
 */
export interface PendingRoster {
  /** In load order — later files win a competition listed twice. */
  files: NamedRosterFile[];
  /**
   * Badge packs picked in the same Import. They are applied on the New League
   * screen, once the clubs a roster file installs exist to be matched by name,
   * but letting them ride along means a player can pick every file the Roster
   * files section offers in one go rather than learning which screen wants
   * which.
   */
  logos?: NamedLogoPack[];
}

let pending: PendingRoster | null = null;

export function setPendingRoster(handoff: PendingRoster): void {
  pending = handoff;
}

/** Return the pending roster file, if any, and clear it. */
export function takePendingRoster(): PendingRoster | null {
  const held = pending;
  pending = null;
  return held;
}
