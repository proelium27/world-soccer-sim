import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-09-11",
  title: "The Database's Clubs tab was broken",
  items: [
    "A player reported the Clubs tab not working, and it wasn't: it crashed into the error page on any save that had played a match. It worked only on the day a new season started, before a ball was kicked, which is why it got through.",
    "Each division's table was being built from its own clubs but from **every** match in the world, so the moment it reached a fixture from another division it fell over. It reads its own division's matches now. Nothing was ever written to your save when it crashed, so any save that hit it is fine.",
    "While in there: the Pts column now applies points deductions, so a club serving a penalty reads the same here as it does on the league table.",
  ],
};

export default entry;
