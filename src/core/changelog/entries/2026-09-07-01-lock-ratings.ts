import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-09-07",
  title: "God Mode can freeze a player's ratings",
  items: [
    "Lock a player's ratings and the offseason stops moving him. He won't grow, he won't decline with age, and his overall and potential stay put too. There's a **Lock ratings** button on his profile, a checkbox in the edit window if you're already in there, and a Lock button on every row of the Roster Builder when you want to do a whole squad.",
    "This is the thing the player editor couldn't do before. You could set a 34-year-old to whatever you liked, and a season later the age curve had taken most of it back. Saying \"leave this one alone\" meant re-editing him every summer instead.",
    "Everything else about a locked player carries on. He plays, picks up injuries and bans, signs contracts, gets bought and sold, and retires on schedule. Only the ratings stand still, and unlocking him starts him developing again from wherever you left off.",
    "The lock is saved with the game rather than tied to the God Mode switch, so it stays put if you turn God Mode back off. His profile says **Ratings locked** either way, so you can always tell why a player has stopped improving.",
  ],
};

export default entry;
