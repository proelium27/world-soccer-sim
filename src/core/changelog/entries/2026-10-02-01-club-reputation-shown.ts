import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-10-02",
  title: "See every club's reputation",
  items: [
    "**Club History** now shows a club's reputation next to its name, with how much the last summer moved it, and a **Rep** column in the season table for where it stood at the end of each season.",
    "The club **Database** has a **Reputation** column you can sort by, with the same up or down figure beside it.",
    "Reputation only moves in the summer, so the change shows once two summers are on record: after your next summer in an existing save, or your second in a new one.",
    "The **How he sees clubs** card on a player's profile drops its \"Where he'd play\" list, which always matched \"Where he'd most like to go\". That list now has a **Starts** column saying whether he'd start at each club instead.",
  ],
};

export default entry;
